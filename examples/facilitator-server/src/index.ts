#!/usr/bin/env node
/**
 * x402 Facilitator Server CLI
 *
 * Run with: npx x402-facilitator
 * Or after global install: x402-facilitator
 *
 * Environment variables:
 * - PORT: Server port (default: 8090)
 * - DATABASE_URL: PostgreSQL connection string (optional, enables Drizzle tracking)
 * - TRACKING_ALLOW_IN_MEMORY_FALLBACK: set to "true" to continue startup when DB init fails
 * - CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET: For CDP signer
 * - EVM_PRIVATE_KEY, SVM_PRIVATE_KEY: For private key signer (fallback)
 * - EVM_RPC_URL_BASE, EVM_RPC_URL_BASE_SEPOLIA: RPC URLs
 * - UPTO_VERIFY_BALANCE_CHECK: "true" to enforce on-chain balance preflight in /verify for upto
 * - BEARER_TOKEN: Required bearer token for /verify and /settle
 * - BEARER_TOKENS: Optional comma-separated bearer token list (overrides BEARER_TOKEN)
 * - SETTLE_MAX_AMOUNT: optional max settle amount (integer atomic units); abort if exceeded
 * - SETTLE_PAYTO_ALLOWLIST: optional comma-separated payTo allowlist
 * - SETTLE_NETWORK_ALLOWLIST: optional comma-separated network (CAIP-2) allowlist
 * - SETTLE_PREFLIGHT_URL: optional generic HTTP preflight (POST JSON payTo/network/amount)
 * - SETTLE_PREFLIGHT_TIMEOUT_MS: preflight timeout (default 500)
 * - SETTLE_PREFLIGHT_FAIL_OPEN: "true" to allow settle if preflight request fails (default fail-closed)
 */

import pg from "pg";
import { defaultSigners } from "./setup.js";
import { createFacilitator } from "@daydreamsai/facilitator";
import { createApp } from "./app.js";
import { createDrizzleAdapter, createTracking } from "./db.js";
import { runMigrations } from "./db-migrate.js";
import { createBearerTokenModule } from "./modules/bearer-token.js";
import {
  createSettlePolicyHook,
  parseSettlePolicyFromEnv,
} from "./settle-policy.js";

const PORT = parseInt(process.env.PORT || "8090", 10);
const DATABASE_URL = process.env.DATABASE_URL;
const TRACKING_ALLOW_IN_MEMORY_FALLBACK =
  process.env.TRACKING_ALLOW_IN_MEMORY_FALLBACK === "true";
const BEARER_TOKEN = process.env.BEARER_TOKEN?.trim();
const BEARER_TOKENS = process.env.BEARER_TOKENS?.split(",")
  .map((token) => token.trim())
  .filter(Boolean);
const TOKENS = BEARER_TOKENS && BEARER_TOKENS.length > 0
  ? BEARER_TOKENS
  : BEARER_TOKEN
    ? [BEARER_TOKEN]
    : [];

if (TOKENS.length === 0) {
  throw new Error(
    "Set BEARER_TOKEN or BEARER_TOKENS to require bearer auth for facilitator startup."
  );
}

// Database setup (optional)
let pool = DATABASE_URL
  ? new pg.Pool({ connectionString: DATABASE_URL })
  : undefined;
let pgClient = pool ? createDrizzleAdapter(pool) : undefined;

// Run migrations if database is configured
if (pool) {
  try {
    await runMigrations(pool);
  } catch (err) {
    console.error("❌ Database migration failed");
    console.error(err instanceof Error ? err.message : err);

    if (!TRACKING_ALLOW_IN_MEMORY_FALLBACK) {
      console.error(
        "Set TRACKING_ALLOW_IN_MEMORY_FALLBACK=true to continue with in-memory tracking."
      );
      await pool.end().catch(() => {});
      process.exit(1);
    }

    console.error("⚠️ Continuing with in-memory tracking.");
    await pool.end().catch(() => {});
    pool = undefined;
    pgClient = undefined;
  }
}

// Resource tracking (falls back to in-memory if no DATABASE_URL)
const tracking = createTracking(pgClient, {
  onTrackingError: (err, id) => {
    console.error(`[tracking:${id}]`, err);
  },
});

// Optional env-gated settle policy (no-op when unset — same as prior behavior)
const settlePolicy = parseSettlePolicyFromEnv();
const settleHooks = settlePolicy
  ? { onBeforeSettle: createSettlePolicyHook(settlePolicy) }
  : undefined;

// Facilitator + App
const facilitator = createFacilitator({
  ...defaultSigners,
  ...(settleHooks ? { hooks: settleHooks } : {}),
});
const app = createApp({
  facilitator,
  tracking,
  modules: [
    createBearerTokenModule({
      tokens: TOKENS,
      protectedPaths: ["/verify", "/settle"],
      realm: "facilitator",
    }),
  ],
});

app.listen(PORT);
console.log(`x402 Facilitator listening on http://localhost:${PORT}`);
if (settlePolicy) {
  const parts: string[] = [];
  if (settlePolicy.maxAmount !== undefined) {
    parts.push(`maxAmount=${settlePolicy.maxAmount.toString()}`);
  }
  if (settlePolicy.payToAllowlist?.length) {
    parts.push(`payToAllowlist=${settlePolicy.payToAllowlist.length}`);
  }
  if (settlePolicy.networkAllowlist?.length) {
    parts.push(`networkAllowlist=${settlePolicy.networkAllowlist.length}`);
  }
  if (settlePolicy.preflightUrl) {
    parts.push(`preflightUrl=set`);
  }
  console.log(`Settle policy: enabled (${parts.join(", ")})`);
} else {
  console.log(`Settle policy: off (set SETTLE_MAX_AMOUNT / allowlists / SETTLE_PREFLIGHT_URL)`);
}
if (pgClient) {
  console.log(`Resource tracking: PostgreSQL (Drizzle)`);
} else if (DATABASE_URL) {
  console.log(
    `Resource tracking: In-memory (DB init failed; set TRACKING_ALLOW_IN_MEMORY_FALLBACK=true to allow this explicitly)`
  );
} else {
  console.log(`Resource tracking: In-memory (set DATABASE_URL for persistence)`);
}

// Graceful shutdown
const shutdown = async () => {
  tracking.stopAutoPrune();
  if (pool) await pool.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
