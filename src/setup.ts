/**
 * Default Facilitator Setup - Application-specific with side effects
 *
 * This module creates a default facilitator instance based on environment
 * configuration. It has side effects and should only be imported by the
 * CLI server, not by library consumers.
 *
 * Library consumers should use createFacilitator() from the main export instead.
 */

import { CdpClient } from "@coinbase/cdp-sdk";

import {
  createFacilitator,
  type EvmSignerConfig,
  type SvmSignerConfig,
} from "./factory.js";
import { createCdpEvmSigner } from "./signers/cdp.js";
import {
  USE_CDP,
  EVM_RPC_URL_BASE,
  EVM_RPC_URL_BASE_SEPOLIA,
} from "./config.js";

// Re-export types and factory for backwards compatibility
export * from "./factory.js";

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
