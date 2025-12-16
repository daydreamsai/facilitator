import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { EVM_PRIVATE_KEY, SVM_PRIVATE_KEY } from "./config.js";

const normalizedEvmKey = EVM_PRIVATE_KEY?.startsWith("0x")
  ? EVM_PRIVATE_KEY
  : `0x${EVM_PRIVATE_KEY}`;

export const evmAccount = privateKeyToAccount(normalizedEvmKey as `0x${string}`);
console.info(`EVM Facilitator account: ${evmAccount.address}`);

// Initialize the SVM account from private key
export const svmAccount = await createKeyPairSignerFromBytes(
  base58.decode(SVM_PRIVATE_KEY as string)
);
console.info(`SVM Facilitator account: ${svmAccount.address}`);

// Create a Viem client with both wallet and public capabilities
const evmRpcUrl = process.env.EVM_RPC_URL_BASE ?? process.env.RPC_URL;
const viemClient = createWalletClient({
  account: evmAccount,
  chain: base,
  transport: evmRpcUrl ? http(evmRpcUrl) : http(),
}).extend(publicActions);

export const evmSigner = toFacilitatorEvmSigner({
  getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
  address: evmAccount.address,
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) =>
    viemClient.readContract({
      ...args,
      args: args.args || [],
    }),
  verifyTypedData: (args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) => viemClient.verifyTypedData(args as any),
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) =>
    viemClient.writeContract({
      ...args,
      args: args.args || [],
    }),
  sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
    viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
    viemClient.waitForTransactionReceipt(args),
});

// Facilitator can now handle all Solana networks with automatic RPC creation
export const svmSigner = toFacilitatorSvmSigner(svmAccount);
