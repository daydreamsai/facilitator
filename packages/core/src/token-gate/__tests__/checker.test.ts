import { describe, it, expect, beforeEach, vi, afterAll } from "vitest";
import { InMemoryTokenGateCache } from "../cache/memory.js";
import type { TokenGateConfig } from "../types.js";

// Mock the network checkers for this test file only
// Note: This uses vi.mock which hoists - other tests importing these modules
// in the same bun test run may see mocked versions
vi.mock("../networks/evm.js", () => ({
  checkEvmTokenBalance: vi.fn(),
  parseEvmCaip2: vi.fn((caip: string) => {
    const match = caip.match(/^eip155:(\d+)$/);
    if (!match) return null;
    const map: Record<string, string> = { "8453": "base", "1": "ethereum" };
    return map[match[1]] ?? null;
  }),
  isEvmNetwork: vi.fn((caip: string) => caip.startsWith("eip155:")),
}));

vi.mock("../networks/svm.js", () => ({
  checkSplTokenBalance: vi.fn(),
  parseSvmCaip2: vi.fn((caip: string) => {
    if (caip === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") return "solana-mainnet";
    return null;
  }),
  isSvmNetwork: vi.fn((caip: string) => caip.startsWith("solana:")),
}));

// Import after mocks are set up
const { createTokenGateChecker } = await import("../checker.js");

afterAll(() => {
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TokenGateChecker", () => {
  let cache: InMemoryTokenGateCache;
  let mockCheckEvmBalance: ReturnType<typeof vi.fn>;

  const baseConfig: TokenGateConfig = {
    requirement: {
      network: "eip155:8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      minimumBalance: 100_000_000n, // 100 USDC (6 decimals)
    },
    rpcUrl: "https://example.com/rpc",
  };

  beforeEach(async () => {
    cache = new InMemoryTokenGateCache();
    vi.clearAllMocks();

    // Get the mocked function
    const evmModule = await import("../networks/evm.js");
    mockCheckEvmBalance = evmModule.checkEvmTokenBalance as ReturnType<typeof vi.fn>;
  });

  describe("check()", () => {
    it("allows wallet with sufficient balance", async () => {
      mockCheckEvmBalance.mockResolvedValue(200_000_000n); // 200 USDC

      const checker = createTokenGateChecker({ ...baseConfig, cache });
      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.balance).toBe(200_000_000n);
        expect(result.fromCache).toBe(false);
      }
    });

    it("blocks wallet with insufficient balance", async () => {
      mockCheckEvmBalance.mockResolvedValue(50_000_000n); // 50 USDC < 100 required

      const checker = createTokenGateChecker({ ...baseConfig, cache });
      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("insufficient_balance");
        expect(result.retryAfter).toBeDefined();
      }
    });

    it("blocks wallet with zero balance", async () => {
      mockCheckEvmBalance.mockResolvedValue(0n);

      const checker = createTokenGateChecker({ ...baseConfig, cache });
      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("insufficient_balance");
      }
    });

    it("allows wallet with exactly minimum balance", async () => {
      mockCheckEvmBalance.mockResolvedValue(100_000_000n); // Exactly 100 USDC

      const checker = createTokenGateChecker({ ...baseConfig, cache });
      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(true);
    });

    it("uses cached result on second check (no RPC call)", async () => {
      mockCheckEvmBalance.mockResolvedValue(200_000_000n);

      const checker = createTokenGateChecker({ ...baseConfig, cache });

      // First check - hits RPC
      const first = await checker.check("0xUser123");
      expect(first.allowed).toBe(true);
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);

      // Second check - uses cache
      const second = await checker.check("0xUser123");
      expect(second.allowed).toBe(true);
      if (second.allowed) {
        expect(second.fromCache).toBe(true);
      }
      // RPC not called again
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);
    });

    it("returns blocked on immediate retry after insufficient balance", async () => {
      mockCheckEvmBalance.mockResolvedValue(0n);

      const checker = createTokenGateChecker({ ...baseConfig, cache });

      // First check - insufficient
      await checker.check("0xUser123");

      // Immediate retry - should be blocked (cached)
      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("blocked");
      }
      // RPC only called once
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);
    });

    it("sets retryAfter to ~5 minutes in future for blocked wallet", async () => {
      mockCheckEvmBalance.mockResolvedValue(0n);

      const checker = createTokenGateChecker({
        ...baseConfig,
        cache,
        blockedCacheTtlMs: 300_000, // 5 min
      });

      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(false);
      if (!result.allowed && result.retryAfter) {
        const msUntilRetry = result.retryAfter.getTime() - Date.now();
        expect(msUntilRetry).toBeGreaterThan(299_000); // > 4:59
        expect(msUntilRetry).toBeLessThanOrEqual(300_000); // <= 5:00
      }
    });

    it("normalizes wallet address to lowercase", async () => {
      mockCheckEvmBalance.mockResolvedValue(200_000_000n);

      const checker = createTokenGateChecker({ ...baseConfig, cache });

      // Check with uppercase
      await checker.check("0xUSER123");

      // Check with lowercase - should use cache
      const result = await checker.check("0xuser123");

      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.fromCache).toBe(true);
      }
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);
    });
  });

  describe("RPC error handling", () => {
    it("fails closed (denies) on RPC error by default", async () => {
      mockCheckEvmBalance.mockRejectedValue(new Error("RPC timeout"));

      const checker = createTokenGateChecker({
        ...baseConfig,
        cache,
        allowOnRpcFailure: false,
      });

      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("rpc_error");
        expect(result.retryAfter).toBeUndefined();
      }
    });

    it("fails open (allows) on RPC error when configured", async () => {
      mockCheckEvmBalance.mockRejectedValue(new Error("RPC timeout"));

      const checker = createTokenGateChecker({
        ...baseConfig,
        cache,
        allowOnRpcFailure: true,
      });

      const result = await checker.check("0xUser123");

      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.balance).toBe(0n);
      }
    });
  });

  describe("cache TTL", () => {
    it("cache expires after TTL (valid cache)", async () => {
      mockCheckEvmBalance.mockResolvedValue(200_000_000n);

      const checker = createTokenGateChecker({
        ...baseConfig,
        cache,
        validCacheTtlMs: 50, // 50ms TTL for fast test
      });

      // First check - hits RPC
      await checker.check("0xUser123");
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);

      // Immediate - still cached
      await checker.check("0xUser123");
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await sleep(60);

      // After expiry - hits RPC again
      await checker.check("0xUser123");
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(2);
    });

    it("block expires after TTL (blocked cache)", async () => {
      mockCheckEvmBalance.mockResolvedValue(0n);

      const checker = createTokenGateChecker({
        ...baseConfig,
        cache,
        blockedCacheTtlMs: 50, // 50ms TTL for fast test
      });

      // First check - blocked
      await checker.check("0xUser123");
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);

      // Immediate retry - still blocked from cache
      const midResult = await checker.check("0xUser123");
      expect(midResult.allowed).toBe(false);
      if (!midResult.allowed) {
        expect(midResult.reason).toBe("blocked");
      }
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await sleep(60);

      // After expiry - hits RPC again
      await checker.check("0xUser123");
      expect(mockCheckEvmBalance).toHaveBeenCalledTimes(2);
    });
  });

  describe("getRequirement()", () => {
    it("returns the configured requirement", () => {
      const checker = createTokenGateChecker({ ...baseConfig, cache });
      const req = checker.getRequirement();

      expect(req.network).toBe("eip155:8453");
      expect(req.tokenAddress).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
      expect(req.minimumBalance).toBe(100_000_000n);
    });
  });
});
