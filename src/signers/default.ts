/**
 * Default signers using raw private keys.
 * Only loaded when CDP credentials are not configured.
 */

import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

import {
  EVM_PRIVATE_KEY,
  SVM_PRIVATE_KEY,
  EVM_RPC_URL_BASE,
  EVM_RPC_URL_BASE_SEPOLIA,
} from "../config.js";

if (!EVM_PRIVATE_KEY || !SVM_PRIVATE_KEY) {
  throw new Error(
    "Private key signers require EVM_PRIVATE_KEY and SVM_PRIVATE_KEY environment variables"
  );
}

const normalizedEvmKey = EVM_PRIVATE_KEY.startsWith("0x")
  ? EVM_PRIVATE_KEY
  : `0x${EVM_PRIVATE_KEY}`;

export const evmAccount = privateKeyToAccount(
  normalizedEvmKey as `0x${string}`
);
console.info(`EVM Facilitator account: ${evmAccount.address}`);

// Initialize the SVM account from private key
export const svmAccount = await createKeyPairSignerFromBytes(
  base58.decode(SVM_PRIVATE_KEY as string)
);
console.info(`SVM Facilitator account: ${svmAccount.address}`);

/**
 * Create a viem client for a specific chain and RPC URL
 */
function createViemClientForChain(
  chain: typeof base | typeof baseSepolia,
  rpcUrl?: string
) {
  return createWalletClient({
    account: evmAccount,
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  }).extend(publicActions);
}

/**
 * Create a FacilitatorEvmSigner from a viem client
 */
function createSignerFromClient(
  client: ReturnType<typeof createViemClientForChain>
): FacilitatorEvmSigner {
  return toFacilitatorEvmSigner({
    getCode: (args: { address: `0x${string}` }) => client.getCode(args),
    address: evmAccount.address,
    readContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) =>
      client.readContract({
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
    }) => client.verifyTypedData(args as any),
    writeContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
    }) =>
      client.writeContract({
        ...args,
        args: args.args || [],
      }),
    sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
      client.sendTransaction(args),
    waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
      client.waitForTransactionReceipt(args),
  });
}

// Create separate clients and signers for each network
// Base Mainnet
const baseClient = createViemClientForChain(base, EVM_RPC_URL_BASE);
export const baseSigner = createSignerFromClient(baseClient);

// Base Sepolia
const baseSepoliaClient = createViemClientForChain(
  baseSepolia,
  EVM_RPC_URL_BASE_SEPOLIA
);
export const baseSepoliaSigner = createSignerFromClient(baseSepoliaClient);

// Legacy export for backwards compatibility (uses Base mainnet)
export const viemClient = baseClient;
export const evmSigner = baseSigner;

// Facilitator can now handle all Solana networks with automatic RPC creation
export const svmSigner = toFacilitatorSvmSigner(svmAccount);
