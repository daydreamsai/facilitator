/**
 * A signer holds one key, and a key has one nonce sequence.
 *
 * viem resolves the nonce at send time from the chain's pending count, so two broadcasts
 * started before either has landed both read the same number and the loser is rejected
 * `nonce too low`. These tests pin the property that makes that impossible: no two broadcasts
 * from one signer overlap.
 *
 * They drive the queue directly rather than through a chain, because the defect is about
 * ordering rather than about any contract call -- an overlapping pair is the bug whatever it
 * was trying to send.
 */
import { describe, expect, it } from "bun:test";

/**
 * The serialisation the signer applies to `writeContract` and `sendTransaction`, in the same
 * shape as `createSignerFromAccount`. Kept in step with that implementation deliberately: a
 * test that constructed a real signer would need an RPC endpoint and a funded key, and would
 * then be testing viem rather than this ordering rule.
 */
function makeSerialiser() {
  let queue: Promise<unknown> = Promise.resolve();
  return function serialize<T>(broadcast: () => Promise<T>): Promise<T> {
    const result = queue.then(broadcast, broadcast);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

describe("signer broadcast serialisation", () => {
  it("never runs two broadcasts at once", async () => {
    const serialize = makeSerialiser();
    let inFlight = 0;
    let maxInFlight = 0;

    const broadcast = async (delayMs: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      inFlight -= 1;
    };

    // Deliberately out of order: a later call finishing sooner must not let it start sooner.
    await Promise.all([
      serialize(() => broadcast(30)),
      serialize(() => broadcast(1)),
      serialize(() => broadcast(15)),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it("preserves submission order", async () => {
    const serialize = makeSerialiser();
    const finished: number[] = [];

    await Promise.all(
      [30, 1, 15].map((delayMs, index) =>
        serialize(async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          finished.push(index);
        })
      )
    );

    expect(finished).toEqual([0, 1, 2]);
  });

  it("keeps running after a rejected broadcast", async () => {
    // The queue must not be poisoned by a failure: a settlement rejected for insufficient
    // balance is ordinary, and every payment after it would otherwise hang forever.
    const serialize = makeSerialiser();
    const finished: string[] = [];

    const failing = serialize(async () => {
      throw new Error("insufficient balance");
    });
    const following = serialize(async () => {
      finished.push("after");
      return "ok";
    });

    await expect(failing).rejects.toThrow("insufficient balance");
    await expect(following).resolves.toBe("ok");
    expect(finished).toEqual(["after"]);
  });

  it("reports each broadcast's own result to its own caller", async () => {
    const serialize = makeSerialiser();

    const first = serialize(async () => "first-hash");
    const second = serialize(async () => "second-hash");

    expect(await first).toBe("first-hash");
    expect(await second).toBe("second-hash");
  });
});
