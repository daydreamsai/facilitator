import { describe, it, expect, beforeEach } from "bun:test";
import {
  InMemoryUptoSessionStore,
  type UptoSession,
} from "../../src/upto/store.js";

const createMockSession = (
  overrides: Partial<UptoSession> = {}
): UptoSession => ({
  cap: 1000n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  pendingSpent: 0n,
  settledTotal: 0n,
  lastActivityMs: Date.now(),
  status: "open",
  paymentPayload: {
    accepted: {
      scheme: "upto",
      network: "eip155:8453",
    },
    payload: {},
  } as UptoSession["paymentPayload"],
  paymentRequirements: {
    scheme: "upto",
    network: "eip155:8453",
    asset: "0xtoken",
    amount: "100",
    payTo: "0xrecipient",
  } as UptoSession["paymentRequirements"],
  ...overrides,
});

describe("InMemoryUptoSessionStore", () => {
  let store: InMemoryUptoSessionStore;

  beforeEach(() => {
    store = new InMemoryUptoSessionStore();
  });

  describe("get", () => {
    it("returns undefined for non-existent session", () => {
      expect(store.get("non-existent")).toBeUndefined();
    });

    it("returns session after it is set", () => {
      const session = createMockSession();
      store.set("session-1", session);
      expect(store.get("session-1")).toBe(session);
    });
  });

  describe("set", () => {
    it("stores a new session", () => {
      const session = createMockSession();
      store.set("session-1", session);
      expect(store.get("session-1")).toBe(session);
    });

    it("overwrites an existing session", () => {
      const session1 = createMockSession({ cap: 1000n });
      const session2 = createMockSession({ cap: 2000n });

      store.set("session-1", session1);
      store.set("session-1", session2);

      expect(store.get("session-1")?.cap).toBe(2000n);
    });

    it("stores multiple sessions independently", () => {
      const session1 = createMockSession({ cap: 1000n });
      const session2 = createMockSession({ cap: 2000n });

      store.set("session-1", session1);
      store.set("session-2", session2);

      expect(store.get("session-1")?.cap).toBe(1000n);
      expect(store.get("session-2")?.cap).toBe(2000n);
    });
  });

  describe("delete", () => {
    it("removes an existing session", () => {
      const session = createMockSession();
      store.set("session-1", session);
      store.delete("session-1");
      expect(store.get("session-1")).toBeUndefined();
    });

    it("does not throw when deleting non-existent session", () => {
      expect(() => store.delete("non-existent")).not.toThrow();
    });

    it("only removes the specified session", () => {
      const session1 = createMockSession();
      const session2 = createMockSession();

      store.set("session-1", session1);
      store.set("session-2", session2);
      store.delete("session-1");

      expect(store.get("session-1")).toBeUndefined();
      expect(store.get("session-2")).toBe(session2);
    });
  });

  describe("entries", () => {
    it("returns empty iterator when store is empty", () => {
      const entries = Array.from(store.entries());
      expect(entries).toHaveLength(0);
    });

    it("returns all stored sessions", () => {
      const session1 = createMockSession({ cap: 1000n });
      const session2 = createMockSession({ cap: 2000n });
      const session3 = createMockSession({ cap: 3000n });

      store.set("session-1", session1);
      store.set("session-2", session2);
      store.set("session-3", session3);

      const entries = Array.from(store.entries());
      expect(entries).toHaveLength(3);

      const ids = entries.map(([id]) => id);
      expect(ids).toContain("session-1");
      expect(ids).toContain("session-2");
      expect(ids).toContain("session-3");
    });

    it("provides iterable iterator", () => {
      const session = createMockSession();
      store.set("session-1", session);

      let count = 0;
      for (const [id, sess] of store.entries()) {
        expect(id).toBe("session-1");
        expect(sess).toBe(session);
        count++;
      }
      expect(count).toBe(1);
    });
  });

  describe("session status transitions", () => {
    it("allows status update from open to settling", () => {
      const session = createMockSession({ status: "open" });
      store.set("session-1", session);

      session.status = "settling";
      store.set("session-1", session);

      expect(store.get("session-1")?.status).toBe("settling");
    });

    it("allows status update from settling to closed", () => {
      const session = createMockSession({ status: "settling" });
      store.set("session-1", session);

      session.status = "closed";
      store.set("session-1", session);

      expect(store.get("session-1")?.status).toBe("closed");
    });

    it("tracks pendingSpent and settledTotal independently", () => {
      const session = createMockSession({
        pendingSpent: 100n,
        settledTotal: 500n,
      });
      store.set("session-1", session);

      session.pendingSpent = 200n;
      session.settledTotal = 600n;
      store.set("session-1", session);

      const retrieved = store.get("session-1");
      expect(retrieved?.pendingSpent).toBe(200n);
      expect(retrieved?.settledTotal).toBe(600n);
    });
  });
});
