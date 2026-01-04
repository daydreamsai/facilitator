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
  type StarknetConfig,
  type NetworkId,
} from "./factory.js";
import { createCdpEvmSigner, type CdpNetwork } from "./signers/cdp.js";
import {
  USE_CDP,
  SVM_PRIVATE_KEY,
  CDP_ACCOUNT_NAME,
  getNetworkSetups,
  getStarknetNetworkSetups,
  getSvmNetworkSetups,
  getRpcUrl,
} from "./config.js";

// Re-export types and factory for backwards compatibility
export * from "./factory.js";

// ============================================================================
// Default Signers
// ============================================================================

async function createDefaultSigners(): Promise<{
  evmSigners: EvmSignerConfig[];
  svmSigners: SvmSignerConfig[];
  starknetConfigs: StarknetConfig[];
}> {
  const networkSetups = getNetworkSetups();
  const starknetNetworkSetups = getStarknetNetworkSetups();

  const starknetConfigs: StarknetConfig[] = [];
  for (const network of starknetNetworkSetups) {
    if (!network.rpcUrl) {
      console.warn(`⚠️  No RPC URL for ${network.name} - skipping`);
      continue;
    }
    if (!network.paymasterEndpoint) {
      console.warn(`⚠️  No paymaster endpoint for ${network.name} - skipping`);
      continue;
    }

    starknetConfigs.push({
      network: network.caip as StarknetConfig["network"],
      rpcUrl: network.rpcUrl,
      paymasterEndpoint: network.paymasterEndpoint,
      ...(network.paymasterApiKey
        ? { paymasterApiKey: network.paymasterApiKey }
        : {}),
      sponsorAddress: network.sponsorAddress,
    });
  }

  if (USE_CDP) {
    // CDP Signer (preferred)
    const cdp = new CdpClient();

    const account = await cdp.evm.getOrCreateAccount({
      name: CDP_ACCOUNT_NAME!,
    });

    console.info(`CDP Facilitator account: ${account.address}`);

    const evmSigners: EvmSignerConfig[] = [];

    // Create a signer for each configured network
    for (const network of networkSetups) {
      const signer = createCdpEvmSigner({
        cdpClient: cdp,
        account,
        network: network.name as CdpNetwork,
        rpcUrl: network.rpcUrl,
      });

      evmSigners.push({
        signer,
        networks: network.caip as NetworkId,
        schemes: ["exact", "upto"],
        deployERC4337WithEIP6492: true,
        // Enable v1 for networks that support it
        registerV1: network.supportsV1,
        v1NetworkNames: network.supportsV1 ? network.name : undefined,
      });
    }

    // CDP doesn't support SVM yet, use private key signer if available
    const svmSigners: SvmSignerConfig[] = [];
    if (SVM_PRIVATE_KEY) {
      const { createPrivateKeySvmSigner } = await import(
        "./signers/index.js"
      );
      const svmSigner = await createPrivateKeySvmSigner();
      // Register for each configured SVM network
      const svmNetworkSetups = getSvmNetworkSetups();
      for (const network of svmNetworkSetups) {
        svmSigners.push({
          signer: svmSigner,
          networks: network.caip as NetworkId,
        });
      }
    }

    return { evmSigners, svmSigners, starknetConfigs };
  } else {
    // Private Key Signer (fallback)
    const { createPrivateKeyEvmSigner, createPrivateKeySvmSigner } =
      await import("./signers/index.js");

    const evmSigners: EvmSignerConfig[] = [];

    // Create a signer for each configured network
    for (const network of networkSetups) {
      const rpcUrl = getRpcUrl(network.name);
      if (!rpcUrl) {
        console.warn(`⚠️  No RPC URL for ${network.name} - skipping`);
        continue;
      }

      const signer = createPrivateKeyEvmSigner({
        network: network.name,
        rpcUrl,
      });

      evmSigners.push({
        signer,
        networks: network.caip as NetworkId,
        schemes: ["exact", "upto"],
        deployERC4337WithEIP6492: true,
        // Enable v1 for networks that support it
        registerV1: network.supportsV1,
        v1NetworkNames: network.supportsV1 ? network.name : undefined,
      });
    }

    const svmSigners: SvmSignerConfig[] = [];
    if (SVM_PRIVATE_KEY) {
      const svmSigner = await createPrivateKeySvmSigner();
      // Register for each configured SVM network
      const svmNetworkSetups = getSvmNetworkSetups();
      for (const network of svmNetworkSetups) {
        svmSigners.push({
          signer: svmSigner,
          networks: network.caip as NetworkId,
        });
      }
    }

    return { evmSigners, svmSigners, starknetConfigs };
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
