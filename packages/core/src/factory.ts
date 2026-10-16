/**
 * Facilitator Factory - Pure library code with no side effects
 *
 * This module provides the createFacilitator factory and associated types.
 * It can be safely imported without triggering any initialization.
 */

import type { FacilitatorEvmSigner } from "@x402/evm";
import type { FacilitatorSvmSigner } from "@x402/svm";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/facilitator";
import { NETWORKS as V1_NETWORKS } from "@x402/evm/v1";
import { registerExactSvmScheme } from "@x402/svm/exact/facilitator";

import { ExactStarknetScheme } from "./starknet/exact/facilitator.js";
import type { StarknetConfig } from "./starknet/exact/facilitator.js";
import { registerUptoEvmScheme } from "./upto/evm/register.js";

// ============================================================================
// Types
// ============================================================================

export type EvmSchemeType = "exact" | "upto";
export type SvmSchemeType = "exact";
export type { StarknetConfig };

/** CAIP-2 network identifier (e.g., "eip155:8453", "solana:...") */
export type NetworkId = `${string}:${string}`;
/** Legacy/V1 EVM network identifier (e.g., "base", "base-sepolia") */
export type V1NetworkName = string;

export interface EvmSignerConfig {
  /** The EVM signer instance (use toFacilitatorEvmSigner to create one) */
  signer: FacilitatorEvmSigner;
  /** Network(s) to register - CAIP-2 format (e.g., "eip155:8453") */
  networks: NetworkId | NetworkId[];
  /** Which schemes to register for this signer. Defaults to ["exact", "upto"] */
  schemes?: EvmSchemeType[];
  /** Enable ERC-4337 with EIP-6492 signature validation */
  deployERC4337WithEIP6492?: boolean;
  /**
   * Also register v1 exact scheme for backwards compatibility.
   * Only registers for networks that support v1 (from @x402/evm).
   * Defaults to true.
   */
  registerV1?: boolean;
  /**
   * Network name(s) for v1 registration (e.g., "base", "base-sepolia").
   * Required when registerV1 is true to map CAIP IDs to v1 network names.
   */
  v1NetworkNames?: V1NetworkName | V1NetworkName[];
  /**
   * Upto EVM scheme behavior customizations.
   */
  upto?: {
    /**
     * If true, /verify runs an on-chain `balanceOf(owner)` check and fails
     * early with `insufficient_balance` when funds are below requirements.amount.
     */
    verifyBalanceCheck?: boolean;
  };
}

export interface SvmSignerConfig {
  /** The SVM signer instance (use toFacilitatorSvmSigner to create one) */
  signer: FacilitatorSvmSigner;
  /** Network(s) to register - CAIP-2 format (e.g., "solana:...") */
  networks: NetworkId | NetworkId[];
  /** Which schemes to register for this signer. Defaults to ["exact"] */
  schemes?: SvmSchemeType[];
}

/**
 * Abort settlement/verification by returning this from before-hooks.
 * Matches the `@x402/core` facilitator contract:
 *   onBeforeSettle(ctx) => void | { abort: true, reason: string }
 */
export type FacilitatorHookAbort = {
  abort: true;
  reason: string;
};

/** Recover a failed verify/settle by returning a synthetic result. */
export type FacilitatorHookRecover<T> = {
  recovered: true;
  result: T;
};

/**
 * Structural payment context for lifecycle hooks.
 * Declared without hard-coupling to every `@x402/core` release shape; the live
 * facilitator passes at least `paymentPayload` + `requirements`.
 */
export interface FacilitatorHookPaymentContext {
  paymentPayload?: {
    accepted?: {
      payTo?: string;
      network?: string;
      amount?: string;
      asset?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  requirements?: {
    payTo?: string;
    network?: string;
    amount?: string;
    asset?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type FacilitatorBeforeVerifyHook = (
  ctx: FacilitatorHookPaymentContext
) => Promise<void | FacilitatorHookAbort>;

export type FacilitatorAfterVerifyHook = (
  ctx: FacilitatorHookPaymentContext & { result?: unknown }
) => Promise<void>;

export type FacilitatorOnVerifyFailureHook = (
  ctx: FacilitatorHookPaymentContext & { error?: Error }
) => Promise<void | FacilitatorHookRecover<unknown>>;

export type FacilitatorBeforeSettleHook = (
  ctx: FacilitatorHookPaymentContext
) => Promise<void | FacilitatorHookAbort>;

export type FacilitatorAfterSettleHook = (
  ctx: FacilitatorHookPaymentContext & { result?: unknown }
) => Promise<void>;

export type FacilitatorOnSettleFailureHook = (
  ctx: FacilitatorHookPaymentContext & { error?: Error }
) => Promise<void | FacilitatorHookRecover<unknown>>;

export interface FacilitatorHooks {
  onBeforeVerify?: FacilitatorBeforeVerifyHook;
  onAfterVerify?: FacilitatorAfterVerifyHook;
  onVerifyFailure?: FacilitatorOnVerifyFailureHook;
  /**
   * Runs before on-chain settlement. Return `{ abort: true, reason }` to block
   * the settle (x402 core honors this; do not rely on throw-only).
   */
  onBeforeSettle?: FacilitatorBeforeSettleHook;
  onAfterSettle?: FacilitatorAfterSettleHook;
  onSettleFailure?: FacilitatorOnSettleFailureHook;
}

export interface FacilitatorConfig {
  /** EVM signer configurations */
  evmSigners?: EvmSignerConfig[];
  /** SVM signer configurations */
  svmSigners?: SvmSignerConfig[];
  /** Starknet configurations */
  starknetConfigs?: StarknetConfig[];
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
 * ```typescript
 * import { createFacilitator } from "@daydreamsai/facilitator";
 * import { createCdpEvmSigner } from "@daydreamsai/facilitator/signers/cdp";
 *
 * const signer = createCdpEvmSigner({ ... });
 * const facilitator = createFacilitator({
 *   evmSigners: [{
 *     signer,
 *     networks: ["eip155:8453", "eip155:10"],
 *     schemes: ["exact", "upto"],
 *   }],
 *   hooks: {
 *     onBeforeSettle: async (ctx) => {
 *       // Return { abort: true, reason } to block settlement.
 *     },
 *     onAfterSettle: async (ctx) => analytics.track("settlement", ctx),
 *   },
 * });
 * ```
 */
export function createFacilitator(config: FacilitatorConfig): x402Facilitator {
  const facilitator = new x402Facilitator();

  // Register lifecycle hooks (x402 core: before-hooks may return { abort, reason })
  if (config.hooks?.onBeforeVerify) {
    // Cast: structural types match runtime; @x402/core pin may lag exported hook generics.
    facilitator.onBeforeVerify(config.hooks.onBeforeVerify as never);
  }
  if (config.hooks?.onAfterVerify) {
    facilitator.onAfterVerify(config.hooks.onAfterVerify as never);
  }
  if (config.hooks?.onVerifyFailure) {
    facilitator.onVerifyFailure(config.hooks.onVerifyFailure as never);
  }
  if (config.hooks?.onBeforeSettle) {
    facilitator.onBeforeSettle(config.hooks.onBeforeSettle as never);
  }
  if (config.hooks?.onAfterSettle) {
    facilitator.onAfterSettle(config.hooks.onAfterSettle as never);
  }
  if (config.hooks?.onSettleFailure) {
    facilitator.onSettleFailure(config.hooks.onSettleFailure as never);
  }

  // Register EVM signers and their schemes
  for (const evmConfig of config.evmSigners ?? []) {
    const schemes = evmConfig.schemes ?? ["exact", "upto"];
    const registerV1 = evmConfig.registerV1 ?? true;

    if (schemes.includes("exact")) {
      // Register v2 scheme
      facilitator.register(
        evmConfig.networks,
        new ExactEvmScheme(evmConfig.signer, {
          deployERC4337WithEIP6492: evmConfig.deployERC4337WithEIP6492,
        })
      );

      // Register v1 scheme for backwards compatibility
      if (registerV1 && evmConfig.v1NetworkNames) {
        const v1Names = Array.isArray(evmConfig.v1NetworkNames)
          ? evmConfig.v1NetworkNames
          : [evmConfig.v1NetworkNames];

        // Filter to only networks that @x402/evm supports for v1
        const supportedV1Names = v1Names.filter((name) =>
          V1_NETWORKS.includes(name)
        );

        if (supportedV1Names.length > 0) {
          // V1 uses network names (e.g., "base") and must be registered under x402Version=1.
          facilitator.registerV1(
            supportedV1Names as unknown as NetworkId[],
            new ExactEvmSchemeV1(evmConfig.signer, {
              deployERC4337WithEIP6492: evmConfig.deployERC4337WithEIP6492,
            })
          );
        }
      }
    }

    if (schemes.includes("upto")) {
      registerUptoEvmScheme(facilitator, {
        signer: evmConfig.signer,
        networks: evmConfig.networks,
        options: evmConfig.upto,
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

  // Register Starknet schemes
  for (const starknetConfig of config.starknetConfigs ?? []) {
    facilitator.register(
      starknetConfig.network,
      new ExactStarknetScheme(starknetConfig)
    );
  }

  return facilitator;
}
