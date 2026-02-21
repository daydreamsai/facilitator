import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStarknetConfigs } from "../src/starknet-config.js";

const __filename = fileURLToPath(import.meta.url);
const testsDir = resolve(__filename, "..");
const serverDir = resolve(testsDir, "..");

const E2E_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

describe("Starknet setup validation", () => {
  it("fails fast with an actionable error when sponsor is missing", () => {
    const processResult = Bun.spawnSync({
      cmd: ["bun", "-e", 'import "./src/setup.ts";'],
      cwd: serverDir,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        EVM_PRIVATE_KEY: E2E_PRIVATE_KEY,
        EVM_NETWORKS: "base-sepolia",
        STARKNET_NETWORKS: "starknet-mainnet",
        STARKNET_RPC_URL_STARKNET_MAINNET: "https://starknet-mainnet.example.com",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = new TextDecoder().decode(processResult.stdout);
    const stderr = new TextDecoder().decode(processResult.stderr);
    const combinedOutput = `${stdout}\n${stderr}`;

    expect(processResult.exitCode).not.toBe(0);
    expect(combinedOutput).toContain(
      "Missing Starknet sponsor address for starknet-mainnet"
    );
    expect(combinedOutput).toContain(
      "STARKNET_SPONSOR_ADDRESS_STARKNET_MAINNET"
    );
  });

  it("skips Starknet networks with unresolved RPC URLs", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(" "));
    };

    try {
      const configs = buildStarknetConfigs([
        {
          name: "starknet-mainnet",
          caip: "starknet:SN_MAIN",
          rpcUrl: undefined,
          paymasterEndpoint: "https://starknet.paymaster.avnu.fi",
          paymasterApiKey: "api-key",
          sponsorAddress: "0xmainnet-sponsor",
        },
      ]);

      expect(configs).toEqual([]);
      expect(warnings).toContain("⚠️  No RPC URL for starknet-mainnet - skipping");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("skips Starknet networks with unresolved paymaster endpoints", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(" "));
    };

    try {
      const configs = buildStarknetConfigs([
        {
          name: "starknet-sepolia",
          caip: "starknet:SN_SEPOLIA",
          rpcUrl: "https://starknet-sepolia.example.com",
          paymasterEndpoint: undefined,
          paymasterApiKey: "api-key",
          sponsorAddress: "0xsepolia-sponsor",
        },
      ]);

      expect(configs).toEqual([]);
      expect(warnings).toContain(
        "⚠️  No paymaster endpoint for starknet-sepolia - skipping"
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});
