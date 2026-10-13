/**
 * A load-balanced RPC can answer `eth_getTransactionCount(pending)` from a node that has not yet
 * seen the transaction just broadcast. These tests drive a real signer against a mocked RPC
 * whose pending count never advances, and pin that nonces still come out in sequence and that
 * a nonce error makes the next send resync from the chain.
 */
import { describe, expect, it } from "bun:test";
import { createNonceManager, custom, parseTransaction, type EIP1193RequestFn } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { jsonRpc } from "viem/nonce";

const TEST_KEY = ("0x" + "11".repeat(32)) as `0x${string}`;

// default.ts reads config.ts, which exits the process when no signer is configured.
process.env.EVM_PRIVATE_KEY ??= TEST_KEY;
const { createSignerFromAccount } = await import("../default.js");

function mockRpc(options: { pendingCount: () => number; reject?: (nonce: number) => string | undefined }) {
  const sentNonces: number[] = [];
  let countReads = 0;
  const request = (async ({ method, params }: { method: string; params?: unknown[] }) => {
    switch (method) {
      case "eth_chainId":
        return `0x${baseSepolia.id.toString(16)}`;
      case "eth_getTransactionCount":
        countReads += 1;
        return `0x${options.pendingCount().toString(16)}`;
      case "eth_estimateGas":
        return "0x5208";
      case "eth_maxPriorityFeePerGas":
      case "eth_gasPrice":
        return "0x1";
      case "eth_getBlockByNumber":
        return { baseFeePerGas: "0x1", number: "0x1", hash: "0x" + "00".repeat(32) };
      case "eth_sendRawTransaction": {
        const tx = parseTransaction((params as `0x${string}`[])[0]);
        const nonce = tx.nonce ?? -1;
        sentNonces.push(nonce);
        const failure = options.reject?.(nonce);
        if (failure) throw Object.assign(new Error(failure), { code: -32000 });
        return "0x" + nonce.toString(16).padStart(64, "0");
      }
      default:
        throw new Error(`unexpected method ${method}`);
    }
  }) as unknown as EIP1193RequestFn;
  return { transport: custom({ request }), sentNonces, countReads: () => countReads };
}

function makeSigner(transport: ReturnType<typeof custom>) {
  const nonceManager = createNonceManager({ source: jsonRpc() });
  const resets: Array<{ address: string; chainId: number }> = [];
  const reset = nonceManager.reset.bind(nonceManager);
  nonceManager.reset = (args) => {
    resets.push(args);
    reset(args);
  };
  const account = privateKeyToAccount(TEST_KEY, { nonceManager });
  return { signer: createSignerFromAccount(account, baseSepolia, transport), resets, account };
}

const to = "0x000000000000000000000000000000000000dEaD" as const;

describe("signer nonce assignment", () => {
  it("assigns consecutive nonces when the pending count lags", async () => {
    const rpc = mockRpc({ pendingCount: () => 5 });
    const { signer } = makeSigner(rpc.transport);

    await Promise.all([
      signer.sendTransaction({ to, data: "0x" }),
      signer.sendTransaction({ to, data: "0x" }),
      signer.sendTransaction({ to, data: "0x" }),
    ]);
    await signer.sendTransaction({ to, data: "0x" });

    expect(rpc.sentNonces).toEqual([5, 6, 7, 8]);
  });

  it("resets the manager after a nonce error and moves past the used nonce", async () => {
    let chainCount = 5;
    let failNext = false;
    const rpc = mockRpc({
      pendingCount: () => chainCount,
      reject: (nonce) => {
        if (failNext) {
          failNext = false;
          return "replacement transaction underpriced";
        }
        chainCount = nonce + 1;
        return undefined;
      },
    });
    const { signer, resets, account } = makeSigner(rpc.transport);

    await signer.sendTransaction({ to, data: "0x" });
    // Something outside this signer has used nonces 6..9, and nonce 10 is already pending.
    chainCount = 10;
    failNext = true;
    await expect(signer.sendTransaction({ to, data: "0x" })).rejects.toThrow(
      /replacement transaction underpriced/
    );
    expect(resets).toContainEqual({ address: account.address, chainId: baseSepolia.id });

    const readsBeforeResync = rpc.countReads();
    await signer.sendTransaction({ to, data: "0x" });

    expect(rpc.countReads()).toBeGreaterThan(readsBeforeResync);
    expect(rpc.sentNonces).toEqual([5, 10, 11]);
  });
});
