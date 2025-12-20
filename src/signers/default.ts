/**
 * Default signers using raw private keys.
 * Only loaded when CDP credentials are not configured.
 */

import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { createWalletClient, http, publicActions, type Chain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  abstract,
  abstractTestnet,
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from "viem/chains";

import {
  EVM_PRIVATE_KEY,
  SVM_PRIVATE_KEY,
  EVM_RPC_URL_BASE,
  EVM_RPC_URL_BASE_SEPOLIA,
} from "../config.js";

// ============================================================================
// Network to Chain Mapping
// ============================================================================

const NETWORK_TO_CHAIN: Record<string, Chain> = {
  abstract,
  "abstract-testnet": abstractTestnet,
  arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  avalanche,
  "avalanche-fuji": avalancheFuji,
  base,
  "base-sepolia": baseSepolia,
  ethereum: mainnet,
  optimism,
  "optimism-sepolia": optimismSepolia,
  polygon,
  "polygon-amoy": polygonAmoy,
  sepolia,
};

// ============================================================================
// Private Key Signer Factory
// ============================================================================

export interface PrivateKeySignerConfig {
  /** Network name (e.g., "base", "base-sepolia") */
  network: string;
  /** RPC URL for the network */
  rpcUrl: string;
  /** Optional private key override (defaults to EVM_PRIVATE_KEY env var) */
  privateKey?: string;
}

/**
 * Creates a FacilitatorEvmSigner from a private key for a specific network.
 *
 * @example
 * ```typescript
 * const signer = createPrivateKeyEvmSigner({
 *   network: "base",
 *   rpcUrl: "https://mainnet.base.org",
 * });
 * ```
 */
export function createPrivateKeyEvmSigner(
  config: PrivateKeySignerConfig
): FacilitatorEvmSigner {
  const { network, rpcUrl, privateKey } = config;

  const key = privateKey ?? EVM_PRIVATE_KEY;
  if (!key) {
    throw new Error("Private key signer requires EVM_PRIVATE_KEY or privateKey option");
  }

  const chain = NETWORK_TO_CHAIN[network];
  if (!chain) {
    throw new Error(`Unsupported network: ${network}. Add it to NETWORK_TO_CHAIN.`);
  }

  const normalizedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(normalizedKey as `0x${string}`);

  return createSignerFromAccount(account, chain, rpcUrl);
}

/**
 * Create a FacilitatorEvmSigner from an account and chain config
 */
function createSignerFromAccount(
  account: PrivateKeyAccount,
  chain: Chain,
  rpcUrl?: string
): FacilitatorEvmSigner {
  const client = createWalletClient({
    account,
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  }).extend(publicActions);

  return toFacilitatorEvmSigner({
    getCode: (args: { address: `0x${string}` }) => client.getCode(args),
    address: account.address,
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

// ============================================================================
// Legacy Default Signers (for backwards compatibility)
// ============================================================================

// These legacy exports are conditionally initialized
// New code should use createPrivateKeyEvmSigner() instead

let evmAccount: ReturnType<typeof privateKeyToAccount> | undefined;
let svmAccount: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>> | undefined;
let baseSigner: FacilitatorEvmSigner | undefined;
let baseSepoliaSigner: FacilitatorEvmSigner | undefined;
let evmSigner: FacilitatorEvmSigner | undefined;
let svmSigner: ReturnType<typeof toFacilitatorSvmSigner> | undefined;
let viemClient: ReturnType<typeof createWalletClient> | undefined;

// Initialize legacy EVM signers if private key is set
if (EVM_PRIVATE_KEY) {
  const normalizedEvmKey = EVM_PRIVATE_KEY.startsWith("0x")
    ? EVM_PRIVATE_KEY
    : `0x${EVM_PRIVATE_KEY}`;

  evmAccount = privateKeyToAccount(normalizedEvmKey as `0x${string}`);

  // Create legacy signers using the new factory
  baseSigner = createPrivateKeyEvmSigner({
    network: "base",
    rpcUrl: EVM_RPC_URL_BASE ?? "https://mainnet.base.org",
  });

  baseSepoliaSigner = createPrivateKeyEvmSigner({
    network: "base-sepolia",
    rpcUrl: EVM_RPC_URL_BASE_SEPOLIA ?? "https://sepolia.base.org",
  });

  evmSigner = baseSigner;
}

// Initialize SVM signer if private key is set
if (SVM_PRIVATE_KEY) {
  svmAccount = await createKeyPairSignerFromBytes(
    base58.decode(SVM_PRIVATE_KEY as string)
  );
  svmSigner = toFacilitatorSvmSigner(svmAccount);
}

export {
  evmAccount,
  svmAccount,
  baseSigner,
  baseSepoliaSigner,
  evmSigner,
  svmSigner,
  viemClient,
};
