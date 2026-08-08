import { describe, expect, it, mock } from "bun:test";
import {
  createSettlePolicyHook,
  evaluateLocalSettlePolicy,
  parseSettlePolicyFromEnv,
  resolveSettleFields,
} from "../src/settle-policy.js";

describe("parseSettlePolicyFromEnv", () => {
  it("returns null when no settle env knobs are set", () => {
    expect(parseSettlePolicyFromEnv({})).toBeNull();
  });

  it("parses max amount and allowlists", () => {
    const cfg = parseSettlePolicyFromEnv({
      SETTLE_MAX_AMOUNT: "1000",
      SETTLE_PAYTO_ALLOWLIST: "0xABC, solAddr",
      SETTLE_NETWORK_ALLOWLIST: "eip155:8453,solana:mainnet",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.maxAmount).toBe(1000n);
    expect(cfg!.payToAllowlist).toEqual(["0xabc", "solAddr"]);
    expect(cfg!.networkAllowlist).toEqual(["eip155:8453", "solana:mainnet"]);
  });

  it("throws on non-integer SETTLE_MAX_AMOUNT", () => {
    expect(() =>
      parseSettlePolicyFromEnv({ SETTLE_MAX_AMOUNT: "1.5" })
    ).toThrow(/SETTLE_MAX_AMOUNT/);
  });
});

describe("evaluateLocalSettlePolicy", () => {
  const ctx = {
    requirements: {
      payTo: "0xAbC",
      network: "eip155:8453",
      amount: "500",
    },
  };

  it("allows when under max and on allowlists", () => {
    const result = evaluateLocalSettlePolicy(
      {
        maxAmount: 1000n,
        payToAllowlist: ["0xabc"],
        networkAllowlist: ["eip155:8453"],
      },
      ctx
    );
    expect(result).toBeUndefined();
  });

  it("aborts when amount exceeds max", () => {
    const result = evaluateLocalSettlePolicy({ maxAmount: 100n }, ctx);
    expect(result).toEqual({
      abort: true,
      reason: expect.stringContaining("exceeds SETTLE_MAX_AMOUNT") as unknown as string,
    });
    expect(result && "abort" in result && result.abort).toBe(true);
  });

  it("aborts when payTo not allowlisted", () => {
    const result = evaluateLocalSettlePolicy(
      { payToAllowlist: ["0xdead"] },
      ctx
    );
    expect(result && "abort" in result && result.abort).toBe(true);
  });

  it("aborts when network not allowlisted", () => {
    const result = evaluateLocalSettlePolicy(
      { networkAllowlist: ["eip155:1"] },
      ctx
    );
    expect(result && "abort" in result && result.abort).toBe(true);
  });

  it("resolves fields from paymentPayload.accepted fallback", () => {
    const fields = resolveSettleFields({
      paymentPayload: {
        accepted: {
          payTo: "Seller",
          network: "solana:devnet",
          amount: "9",
        },
      },
    });
    expect(fields).toEqual({
      payTo: "Seller",
      network: "solana:devnet",
      amount: "9",
      asset: undefined,
    });
  });
});

describe("createSettlePolicyHook preflight", () => {
  it("aborts on allow:false JSON body", async () => {
    const fetchImpl = mock(async () =>
      new Response(JSON.stringify({ allow: false, reason: "blocked" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const hook = createSettlePolicyHook(
      { preflightUrl: "http://policy.test/preflight" },
      fetchImpl as unknown as typeof fetch
    );
    const result = await hook({
      requirements: { payTo: "x", network: "n", amount: "1" },
    });
    expect(result).toEqual({ abort: true, reason: "blocked" });
  });

  it("aborts on HTTP 403", async () => {
    const fetchImpl = mock(
      async () => new Response("no", { status: 403 })
    );
    const hook = createSettlePolicyHook(
      { preflightUrl: "http://policy.test/preflight" },
      fetchImpl as unknown as typeof fetch
    );
    const result = await hook({
      requirements: { payTo: "x", network: "n", amount: "1" },
    });
    expect(result && "abort" in result && result.abort).toBe(true);
  });

  it("fail-open skips abort on fetch error when configured", async () => {
    const fetchImpl = mock(async () => {
      throw new Error("network down");
    });
    const hook = createSettlePolicyHook(
      {
        preflightUrl: "http://policy.test/preflight",
        failClosedOnPreflightError: false,
      },
      fetchImpl as unknown as typeof fetch
    );
    const result = await hook({
      requirements: { payTo: "x", network: "n", amount: "1" },
    });
    expect(result).toBeUndefined();
  });
});
