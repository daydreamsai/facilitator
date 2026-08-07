/**
 * Upto EVM Settlement
 *
 * On-chain settlement execution for the upto EVM scheme.
 */

import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { getAddress, parseSignature } from "viem";

import {
  type UptoEvmPayload,
  permitAbi,
  erc20Abi,
  toBigInt,
  errorSummary,
} from "./constants.js";

function mapTransferErrorReason(error: unknown): string {
  const summary = errorSummary(error).toLowerCase();

  if (
    summary.includes("transfer amount exceeds balance") ||
    summary.includes("insufficient balance")
  ) {
    return "insufficient_balance";
  }

  if (
    summary.includes("transfer amount exceeds allowance") ||
    summary.includes("insufficient allowance")
  ) {
    return "insufficient_allowance";
  }

  return "transaction_failed";
}

/**
 * Context needed for settlement.
 */
export interface SettlementContext {
  signer: FacilitatorEvmSigner;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  verification: VerifyResponse;
}

/**
 * Settle an upto EVM payment on-chain.
 *
 * This function:
 * 1. Validates the payment was verified
 * 2. Parses the permit signature
 * 3. Applies the permit (or falls back to existing allowance)
 * 4. Executes transferFrom to move tokens to payTo
 */
export async function settleUptoPayment(
  ctx: SettlementContext
): Promise<SettleResponse> {
  const { signer, payload, requirements, verification } = ctx;

  // Fail fast if verification failed
  if (!verification.isValid) {
    return {
      success: false,
      errorReason: verification.invalidReason ?? "invalid_upto_evm_payload",
      transaction: "",
      network: payload.accepted.network,
      payer: verification.payer,
    };
  }

  const uptoPayload = payload.payload as unknown as UptoEvmPayload;
  const authorization = uptoPayload.authorization;
  const payer = getAddress(authorization.from);
  const spender = getAddress(
    (authorization.to ?? requirements.payTo) as `0x${string}`
  );

  const cap = toBigInt(authorization.value);
  const totalSpent = toBigInt(requirements.amount);
  const erc20Address = getAddress(requirements.asset);

  // Parse ECDSA signature
  let parsedSig: ReturnType<typeof parseSignature> | null = null;
  try {
    parsedSig = parseSignature(uptoPayload.signature);
  } catch {
    parsedSig = null;
  }

  if (!parsedSig || (!parsedSig.v && parsedSig.yParity === undefined)) {
    return {
      success: false,
      errorReason: "unsupported_signature_type",
      transaction: "",
      network: payload.accepted.network,
      payer,
    };
  }

  const v = parsedSig.v ?? parsedSig.yParity;
  const r = parsedSig.r;
  const s = parsedSig.s;
  const deadline = toBigInt(authorization.validBefore);

  // Step 1: Try to apply permit for the cap
  let permitError: unknown | undefined;
  try {
    const permitTx = await signer.writeContract({
      address: erc20Address,
      abi: permitAbi,
      functionName: "permit",
      args: [payer, spender, cap, deadline, v, r, s],
    });

    await signer.waitForTransactionReceipt({ hash: permitTx });
  } catch (error) {
    permitError = error;

    // If permit fails (already used), check existing allowance
    try {
      const allowance = (await signer.readContract({
        address: erc20Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [payer, spender],
      })) as bigint;

      if (allowance < totalSpent) {
        console.error("Permit failed:", errorSummary(permitError));
        console.error("Allowance insufficient:", {
          allowance: allowance.toString(),
          required: totalSpent.toString(),
          payer,
          spender,
          asset: erc20Address,
        });
        return {
          success: false,
          errorReason: "insufficient_allowance",
          transaction: "",
          network: payload.accepted.network,
          payer,
        };
      }
    } catch {
      return {
        success: false,
        errorReason: "permit_failed",
        transaction: "",
        network: payload.accepted.network,
        payer,
      };
    }
  }

  // Step 2: Execute transferFrom.
  //
  // The broadcast and the wait for its receipt are separate concerns and must fail
  // differently. Broadcasting can fail before anything leaves this process, in which case no
  // money has moved and there is no transaction to name. Waiting can fail after the transfer
  // is already in the mempool -- a dropped RPC connection, a receipt slower than the client's
  // timeout -- and that is not the payment failing. It is the payment's outcome being unknown
  // to us, while the transfer very likely lands moments later.
  //
  // Reporting the second as a plain failure with `transaction: ""` was losing the only handle
  // anyone had on money that had already moved: the caller records no payment reference, so
  // the transfer cannot afterwards be found, reconciled, or refunded. The hash is therefore
  // returned even when the receipt is not, so an unknown outcome stays recoverable.
  let tx: `0x${string}`;
  try {
    tx = await signer.writeContract({
      address: erc20Address,
      abi: erc20Abi,
      functionName: "transferFrom",
      args: [payer, getAddress(requirements.payTo), totalSpent],
    });
  } catch (error) {
    console.error("Failed to broadcast upto settlement:", error);
    return {
      success: false,
      errorReason: mapTransferErrorReason(error),
      transaction: "",
      network: payload.accepted.network,
      payer,
    };
  }

  try {
    const receipt = await signer.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: "invalid_transaction_state",
        transaction: tx,
        network: payload.accepted.network,
        payer,
      };
    }

    return {
      success: true,
      transaction: tx,
      network: payload.accepted.network,
      payer,
    };
  } catch (error) {
    // Broadcast, outcome unknown. Deliberately not mapped through
    // mapTransferErrorReason: that reads revert text to explain why a transfer was rejected,
    // and nothing here has been rejected -- the chain has not answered yet.
    console.error(
      "Upto settlement was broadcast but its receipt could not be read:",
      { hash: tx, error: errorSummary(error) }
    );
    return {
      success: false,
      errorReason: "settlement_receipt_unavailable",
      transaction: tx,
      network: payload.accepted.network,
      payer,
    };
  }
}
