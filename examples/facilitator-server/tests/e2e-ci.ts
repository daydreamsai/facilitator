import { strict as assert } from "node:assert";
import { Pool } from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveE2ePrivateKey } from "./e2e-env.js";

const __filename = fileURLToPath(import.meta.url);
const testsDir = resolve(__filename, "..");
const serverDir = resolve(testsDir, "..");

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT ?? "18090");
const BEARER_TOKEN = process.env.BEARER_TOKEN ?? "e2e-test-token";
const STARKNET_NETWORKS = "starknet-mainnet";
const STARKNET_MAINNET_CAIP = "starknet:SN_MAIN";
const STARKNET_MAINNET_RPC_URL = "https://starknet-mainnet.example.com";
const STARKNET_MAINNET_PAYMASTER_ENDPOINT =
  "https://starknet.paymaster.avnu.fi";
const STARKNET_MAINNET_SPONSOR = "0xstarknet-mainnet-sponsor";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for e2e test");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/supported`);
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await sleep(500);
  }

  throw new Error("Timed out waiting for facilitator server to start");
}

async function waitForDatabase(
  pool: Pool,
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      // Database not ready yet.
    }
    await sleep(500);
  }

  throw new Error("Timed out waiting for Postgres to become ready");
}

async function waitForRecord(pool: Pool, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM resource_call_records
       WHERE path = '/verify' AND response_status = 400`
    );

    if (Number(result.rows[0]?.count ?? "0") > 0) {
      return;
    }

    await sleep(300);
  }

  throw new Error("No /verify tracking row found in Postgres");
}

function assertStarknetSupportedPayload(payload: unknown): void {
  const supported = payload as {
    kinds?: Array<{
      network?: string;
      scheme?: string;
      x402Version?: number;
      extra?: { paymasterEndpoint?: string; sponsorAddress?: string };
    }>;
    signers?: Record<string, string[]>;
  };

  const starknetKind = supported.kinds?.find(
    (kind) =>
      kind.network === STARKNET_MAINNET_CAIP && kind.scheme === "exact"
  );

  assert.ok(starknetKind, "Expected /supported to include Starknet exact kind");
  assert.equal(
    starknetKind?.x402Version,
    2,
    "Expected Starknet supported kind to be x402 v2"
  );
  assert.equal(
    starknetKind?.extra?.paymasterEndpoint,
    STARKNET_MAINNET_PAYMASTER_ENDPOINT,
    "Expected Starknet paymaster endpoint in /supported extra metadata"
  );
  assert.equal(
    starknetKind?.extra?.sponsorAddress,
    STARKNET_MAINNET_SPONSOR,
    "Expected Starknet sponsor address in /supported extra metadata"
  );

  const starknetSigners = supported.signers?.["starknet:*"] ?? [];
  assert.ok(
    starknetSigners.includes(STARKNET_MAINNET_SPONSOR),
    "Expected Starknet sponsor address in /supported signers"
  );
}

async function run(): Promise<void> {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  let failed = false;
  const privateKey = resolveE2ePrivateKey(process.env.EVM_PRIVATE_KEY);
  if (process.env.EVM_PRIVATE_KEY && privateKey !== process.env.EVM_PRIVATE_KEY) {
    console.warn(
      "EVM_PRIVATE_KEY for e2e was malformed; using normalized fallback key."
    );
  }

  const server = Bun.spawn({
    cmd: ["node", "dist/index.js"],
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL,
      TRACKING_ALLOW_IN_MEMORY_FALLBACK: "false",
      OTEL_SDK_DISABLED: "true",
      BEARER_TOKEN,
      EVM_PRIVATE_KEY: privateKey,
      EVM_NETWORKS: process.env.EVM_NETWORKS ?? "base-sepolia",
      STARKNET_NETWORKS,
      STARKNET_RPC_URL_STARKNET_MAINNET: STARKNET_MAINNET_RPC_URL,
      STARKNET_PAYMASTER_ENDPOINT_STARKNET_MAINNET:
        STARKNET_MAINNET_PAYMASTER_ENDPOINT,
      STARKNET_SPONSOR_ADDRESS_STARKNET_MAINNET: STARKNET_MAINNET_SPONSOR,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutTextPromise = new Response(server.stdout).text();
  const stderrTextPromise = new Response(server.stderr).text();

  try {
    await waitForDatabase(pool);
    await waitForServer(baseUrl);
    await pool.query("TRUNCATE TABLE resource_call_records");

    const supportedResponse = await fetch(`${baseUrl}/supported`);
    assert.equal(
      supportedResponse.status,
      200,
      "Expected /supported to return 200"
    );
    const supportedPayload = await supportedResponse.json();
    assertStarknetSupportedPayload(supportedPayload);

    const verifyResponse = await fetch(`${baseUrl}/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({}),
    });

    assert.equal(verifyResponse.status, 400, "Expected /verify to return 400");
    await waitForRecord(pool);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    server.kill();
    await server.exited;
    await pool.end();

    const stdoutText = await stdoutTextPromise.catch(() => "");
    const stderrText = await stderrTextPromise.catch(() => "");
    if (failed && stdoutText.trim()) {
      console.log("=== facilitator stdout ===");
      console.log(stdoutText);
    }
    if (failed && stderrText.trim()) {
      console.log("=== facilitator stderr ===");
      console.log(stderrText);
    }
  }
}

run().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
