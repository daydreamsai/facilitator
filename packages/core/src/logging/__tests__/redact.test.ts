import { afterEach, describe, expect, it } from "bun:test";
import { HttpRequestError } from "viem";

import {
  collectSecretsFromEnv,
  formatForLog,
  installLogRedaction,
  redactSecrets,
} from "../redact.js";

const KEY = "AbCdEfGhIjKlMnOpQrStUvWx1234";
const RPC_URL = `https://base-sepolia.g.example.com/v2/${KEY}`;

function viemStyleError(): Error {
  return new HttpRequestError({
    url: RPC_URL,
    body: { method: "eth_sendRawTransaction", params: ["0xdeadbeef"] },
    details: "replacement transaction underpriced",
  });
}

describe("log redaction", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("strips the URL and Request body lines and path keys from a viem error", () => {
    const out = formatForLog(["Settle error:", viemStyleError()]);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("0xdeadbeef");
    expect(out).toContain("URL: [redacted]");
    expect(out).toContain("Request body: [redacted]");
    expect(out).toContain("replacement transaction underpriced");
  });

  it("removes configured secrets in any shape", () => {
    const secrets = collectSecretsFromEnv({
      EVM_PRIVATE_KEY: "0x" + "ab".repeat(32),
      BEARER_TOKENS: "tok-one-123456,tok-two-654321",
      DATABASE_URL: "postgres://user:hunter2pass@db:5432/x",
      PORT: "8090",
    });
    const text = `pk=${"ab".repeat(32)} t=tok-two-654321 db=postgres://user:hunter2pass@db:5432/x port 8090`;
    const out = redactSecrets(text, secrets);
    expect(out).not.toContain("ab".repeat(32));
    expect(out).not.toContain("tok-two-654321");
    expect(out).not.toContain("hunter2pass");
    expect(out).toContain("8090");
  });

  it("redacts errors logged through console once installed", () => {
    const captured: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      captured.push(args.map(String).join(" "));
    };
    try {
      restore = installLogRedaction({ secrets: [] });
      console.error("Failed to broadcast upto settlement:", viemStyleError());
    } finally {
      restore?.();
      restore = undefined;
      console.error = original;
    }
    expect(captured.join("\n")).not.toContain(KEY);
    expect(captured.join("\n")).toContain("[redacted]");
  });

  it("redacts writes to stdout once installed", () => {
    const writes: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      restore = installLogRedaction({ secrets: [] });
      process.stdout.write(JSON.stringify({ msg: viemStyleError().message }) + "\n");
    } finally {
      restore?.();
      restore = undefined;
      process.stdout.write = original;
    }
    expect(writes.join("")).not.toContain(KEY);
  });
});
