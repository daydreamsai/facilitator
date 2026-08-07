/**
 * Default signers using raw private keys.
 * Only loaded when CDP credentials are not configured.
 */

import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import {
  toFacilitatorSvmSigner,
  type FacilitatorRpcConfig,
  type FacilitatorSvmSigner,
} from "@x402/svm";
import { createWalletClient, defineChain, http, publicActions, type Chain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { SETTLEMENT_RECEIPT_TIMEOUT_MS } from "../config.js";
import {
  abstract,
  abstractTestnet,
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  gnosis,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  scroll,
  scrollSepolia,
  sepolia,
} from "viem/chains";

import { EVM_PRIVATE_KEY, SVM_PRIVATE_KEY } from "../config.js";

// ============================================================================
// Custom Chain Definitions
// ============================================================================

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadScan', url: 'https://explorer.monad.xyz' },
  },
});

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monad Testnet Explorer', url: 'https://testnet.monadexplorer.com' },
  },
  testnet: true,
});

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
  bsc,
  "bsc-testnet": bscTestnet,
  ethereum: mainnet,
  gnosis,
  monad,
  "monad-testnet": monadTestnet,
  optimism,
  "optimism-sepolia": optimismSepolia,
  polygon,
  "polygon-amoy": polygonAmoy,
  scroll,
  "scroll-sepolia": scrollSepolia,
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

export interface PrivateKeySvmSignerConfig {
  /** Optional private key override (defaults to SVM_PRIVATE_KEY env var) */
  privateKey?: string;
  /** Optional RPC configuration for the facilitator signer */
  rpcConfig?: FacilitatorRpcConfig;
}

/**
 * Creates a FacilitatorSvmSigner from a private key.
 *
 * @example
 * ```typescript
 * const signer = await createPrivateKeySvmSigner();
 * ```
 */
export async function createPrivateKeySvmSigner(
  config: PrivateKeySvmSignerConfig = {}
): Promise<FacilitatorSvmSigner> {
  const key = config.privateKey ?? SVM_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "Private key signer requires SVM_PRIVATE_KEY or privateKey option"
    );
  }

  const signer = await createKeyPairSignerFromBytes(base58.decode(key));
  return toFacilitatorSvmSigner(signer, config.rpcConfig);
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

  // One signer is one key, and a key has one nonce sequence. viem resolves the nonce at send
  // time from the chain's pending count, so two broadcasts started before either has landed
  // both read the same number, build a transaction at it, and the loser is rejected with
  // `nonce too low` or `replacement transaction underpriced`. Nothing above this layer
  // prevents that: a facilitator settles whenever a request arrives, and two payers paying at
  // the same moment is ordinary rather than exceptional.
  //
  // Serialising broadcasts per signer makes the collision impossible instead of merely
  // unlikely. It deliberately covers only the send, not the receipt wait: the nonce is
  // consumed when the transaction is accepted into the mempool, so the next send may start as
  // soon as the previous one has a hash, and holding the queue through confirmation would
  // collapse throughput for no extra safety.
  //
  // A rejected broadcast must not poison the queue, so the tail swallows outcomes and the
  // next call runs either way.
  let broadcastQueue: Promise<unknown> = Promise.resolve();
  const serializeBroadcast = <T>(broadcast: () => Promise<T>): Promise<T> => {
    const result = broadcastQueue.then(broadcast, broadcast);
    broadcastQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

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
      serializeBroadcast(() =>
        client.writeContract({
          ...args,
          args: args.args || [],
        })
      ),
    sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
      serializeBroadcast(() => client.sendTransaction(args)),
    // Bounded on purpose -- viem waits indefinitely by default, which outlives every caller
    // and leaves a request open on a receipt nobody is waiting for. See
    // SETTLEMENT_RECEIPT_TIMEOUT_MS.
    waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
      client.waitForTransactionReceipt({
        ...args,
        timeout: SETTLEMENT_RECEIPT_TIMEOUT_MS,
      }),
  });
}
