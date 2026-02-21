import { beforeAll, describe, expect, it } from "bun:test";
import { createFacilitator } from "@daydreamsai/facilitator";
import { createApp } from "../src/app.js";

interface SupportedKind {
  x402Version: number;
  network: string;
  scheme: string;
  extra?: Record<string, unknown>;
}

interface SupportedResponse {
  kinds: SupportedKind[];
  signers: Record<string, string[]>;
}

const MAINNET_CONFIG = {
  network: "starknet:SN_MAIN" as const,
  rpcUrl: "https://starknet-mainnet.example.com",
  paymasterEndpoint: "https://starknet.paymaster.avnu.fi",
  sponsorAddress: "0xmainnet-sponsor",
};

const SEPOLIA_CONFIG = {
  network: "starknet:SN_SEPOLIA" as const,
  rpcUrl: "https://starknet-sepolia.example.com",
  paymasterEndpoint: "https://paymaster-sepolia.example.com",
  sponsorAddress: "0xsepolia-sponsor",
};

describe("/supported Starknet integration", () => {
  let supported: SupportedResponse;

  beforeAll(async () => {
    const facilitator = createFacilitator({
      starknetConfigs: [MAINNET_CONFIG, SEPOLIA_CONFIG],
    });
    const app = createApp({ facilitator });
    const response = await app.handle(new Request("http://localhost/supported"));

    expect(response.status).toBe(200);
    supported = await (response.json() as Promise<SupportedResponse>);
  });

  it("returns Starknet kinds when Starknet configs are registered", () => {

    const starknetKinds = supported.kinds.filter((kind) =>
      kind.network.startsWith("starknet:")
    );

    expect(starknetKinds.length).toBe(2);
  });

  it("includes Starknet paymaster and sponsor metadata in kind.extra", () => {

    const mainnetKind = supported.kinds.find(
      (kind) => kind.network === MAINNET_CONFIG.network && kind.scheme === "exact"
    );
    const sepoliaKind = supported.kinds.find(
      (kind) => kind.network === SEPOLIA_CONFIG.network && kind.scheme === "exact"
    );

    expect(mainnetKind?.extra).toEqual({
      paymasterEndpoint: MAINNET_CONFIG.paymasterEndpoint,
      sponsorAddress: MAINNET_CONFIG.sponsorAddress,
    });

    expect(sepoliaKind?.extra).toEqual({
      paymasterEndpoint: SEPOLIA_CONFIG.paymasterEndpoint,
      sponsorAddress: SEPOLIA_CONFIG.sponsorAddress,
    });
  });

  it('includes Starknet sponsor addresses in signers["starknet:*"]', () => {

    const starknetSigners = supported.signers["starknet:*"] ?? [];

    expect(starknetSigners).toContain(MAINNET_CONFIG.sponsorAddress);
    expect(starknetSigners).toContain(SEPOLIA_CONFIG.sponsorAddress);
  });

  it("keeps Starknet networks canonical (starknet:SN_*) with x402 v2", () => {

    const starknetKinds = supported.kinds.filter((kind) =>
      kind.network.startsWith("starknet:")
    );

    const networks = starknetKinds.map((kind) => kind.network).sort();
    expect(networks).toEqual(["starknet:SN_MAIN", "starknet:SN_SEPOLIA"]);

    for (const kind of starknetKinds) {
      expect(kind.x402Version).toBe(2);
    }
  });
});
