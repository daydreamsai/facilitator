import type { FacilitatorEvmSigner } from "@x402/evm";
import type { FacilitatorSvmSigner } from "@x402/svm";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { registerExactSvmScheme } from "@x402/svm/exact/facilitator";
import { CdpClient } from "@coinbase/cdp-sdk";

import { registerUptoEvmScheme } from "./upto/evm/register.js";
import { createCdpEvmSigner } from "./signers/cdp.js";
import {
  USE_CDP,
  EVM_RPC_URL_BASE,
  EVM_RPC_URL_BASE_SEPOLIA,
} from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type EvmSchemeType = "exact" | "upto";
export type SvmSchemeType = "exact";

/** CAIP-2 network identifier (e.g., "eip155:8453", "solana:...") */
export type NetworkId = `${string}:${string}`;

export interface EvmSignerConfig {
  /** The EVM signer instance (use toFacilitatorEvmSigner to create one) */
  signer: FacilitatorEvmSigner;
  /** Network(s) to register - CAIP-2 format (e.g., "eip155:8453") */
  networks: NetworkId | NetworkId[];
  /** Which schemes to register for this signer. Defaults to ["exact", "upto"] */
  schemes?: EvmSchemeType[];
  /** Enable ERC-4337 with EIP-6492 signature validation */
  deployERC4337WithEIP6492?: boolean;
}

export interface SvmSignerConfig {
  /** The SVM signer instance (use toFacilitatorSvmSigner to create one) */
  signer: FacilitatorSvmSigner;
  /** Network(s) to register - CAIP-2 format (e.g., "solana:...") */
  networks: NetworkId | NetworkId[];
  /** Which schemes to register for this signer. Defaults to ["exact"] */
  schemes?: SvmSchemeType[];
}

export interface FacilitatorHooks {
  onBeforeVerify?: (ctx: unknown) => Promise<void>;
  onAfterVerify?: (ctx: unknown) => Promise<void>;
  onVerifyFailure?: (ctx: unknown) => Promise<void>;
  onBeforeSettle?: (ctx: unknown) => Promise<void>;
  onAfterSettle?: (ctx: unknown) => Promise<void>;
  onSettleFailure?: (ctx: unknown) => Promise<void>;
}

export interface FacilitatorConfig {
  /** EVM signer configurations */
  evmSigners?: EvmSignerConfig[];
  /** SVM signer configurations */
  svmSigners?: SvmSignerConfig[];
  /** Lifecycle hooks for custom logic */
  hooks?: FacilitatorHooks;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a configured x402 Facilitator with injected signers.
 *
 * @example
 * // With custom signer from your SDK
 * const facilitator = createFacilitator({
 *   evmSigners: [{
 *     signer: myCustomEvmSigner,
 *     networks: ["eip155:8453", "eip155:10"],
 *     schemes: ["exact", "upto"],
 *   }],
 *   hooks: {
 *     onAfterSettle: async (ctx) => analytics.track("settlement", ctx),
 *   },
 * });
 */
export function createFacilitator(config: FacilitatorConfig): x402Facilitator {
  const facilitator = new x402Facilitator();

  // Register lifecycle hooks
  if (config.hooks?.onBeforeVerify) {
    facilitator.onBeforeVerify(config.hooks.onBeforeVerify);
  }
  if (config.hooks?.onAfterVerify) {
    facilitator.onAfterVerify(config.hooks.onAfterVerify);
  }
  if (config.hooks?.onVerifyFailure) {
    facilitator.onVerifyFailure(config.hooks.onVerifyFailure);
  }
  if (config.hooks?.onBeforeSettle) {
    facilitator.onBeforeSettle(config.hooks.onBeforeSettle);
  }
  if (config.hooks?.onAfterSettle) {
    facilitator.onAfterSettle(config.hooks.onAfterSettle);
  }
  if (config.hooks?.onSettleFailure) {
    facilitator.onSettleFailure(config.hooks.onSettleFailure);
  }

  // Register EVM signers and their schemes
  for (const evmConfig of config.evmSigners ?? []) {
    const schemes = evmConfig.schemes ?? ["exact", "upto"];

    if (schemes.includes("exact")) {
      registerExactEvmScheme(facilitator, {
        signer: evmConfig.signer,
        networks: evmConfig.networks,
        deployERC4337WithEIP6492: evmConfig.deployERC4337WithEIP6492,
      });
    }

    if (schemes.includes("upto")) {
      registerUptoEvmScheme(facilitator, {
        signer: evmConfig.signer,
        networks: evmConfig.networks,
      });
    }
  }

  // Register SVM signers and their schemes
  for (const svmConfig of config.svmSigners ?? []) {
    const schemes = svmConfig.schemes ?? ["exact"];

    if (schemes.includes("exact")) {
      registerExactSvmScheme(facilitator, {
        signer: svmConfig.signer,
        networks: svmConfig.networks,
      });
    }
  }

  return facilitator;
}

// ============================================================================
// Default Signers
// ============================================================================

async function createDefaultSigners(): Promise<{
  evmSigners: EvmSignerConfig[];
  svmSigners: SvmSignerConfig[];
}> {
  if (USE_CDP) {
    // CDP Signer (preferred)
    const cdp = new CdpClient();
    const account = await cdp.evm.getOrCreateAccount({ name: "facilitator" });
    console.info(`CDP Facilitator account: ${account.address}`);

    const evmSigners: EvmSignerConfig[] = [];

    // Base Mainnet
    const baseSigner = createCdpEvmSigner({
      cdpClient: cdp,
      account,
      network: "base",
      rpcUrl: EVM_RPC_URL_BASE,
    });
    evmSigners.push({
      signer: baseSigner,
      networks: "eip155:8453",
      schemes: ["exact", "upto"],
      deployERC4337WithEIP6492: true,
    });

    // Base Sepolia
    const baseSepoliaSigner = createCdpEvmSigner({
      cdpClient: cdp,
      account,
      network: "base-sepolia",
      rpcUrl: EVM_RPC_URL_BASE_SEPOLIA,
    });
    evmSigners.push({
      signer: baseSepoliaSigner,
      networks: "eip155:84532",
      schemes: ["exact", "upto"],
      deployERC4337WithEIP6492: true,
    });

    // No SVM signer for CDP (not supported yet)
    return { evmSigners, svmSigners: [] };
  } else {
    // Private Key Signer (fallback)
    // Create separate signers for each network to ensure correct RPC/chain configuration
    const { baseSigner, baseSepoliaSigner, svmSigner } = await import("./signers/index.js");

    return {
      evmSigners: [
        {
          signer: baseSigner,
          networks: "eip155:8453", // Base mainnet
          schemes: ["exact", "upto"],
          deployERC4337WithEIP6492: true,
        },
        {
          signer: baseSepoliaSigner,
          networks: "eip155:84532", // Base Sepolia
          schemes: ["exact", "upto"],
          deployERC4337WithEIP6492: true,
        },
      ],
      svmSigners: [
        {
          signer: svmSigner,
          networks: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        },
      ],
    };
  }
}

// ============================================================================
// Default Instance
// ============================================================================

const defaultSigners = await createDefaultSigners();

/**
 * Default facilitator instance using environment-configured signers.
 * Uses CDP signer if CDP credentials are provided, otherwise falls back to private keys.
 * For custom signers, use createFacilitator() instead.
 */
export const facilitator = createFacilitator({
  ...defaultSigners,
});
