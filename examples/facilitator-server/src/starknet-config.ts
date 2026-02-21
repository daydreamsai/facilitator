import type { FacilitatorConfig } from "@daydreamsai/facilitator";
import type { StarknetNetworkSetup } from "@daydreamsai/facilitator/config";

export type StarknetConfig = FacilitatorConfig["starknetConfigs"] extends
  | (infer T)[]
  | undefined
  ? T
  : never;

/**
 * Converts validated Starknet network setup entries into facilitator configs.
 * Networks with unresolved runtime dependencies are skipped defensively.
 */
export function buildStarknetConfigs(
  starknetNetworkSetups: StarknetNetworkSetup[]
): StarknetConfig[] {
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

  return starknetConfigs;
}
