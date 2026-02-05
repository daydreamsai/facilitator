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
 * - CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET: For CDP signer
 * - EVM_PRIVATE_KEY, SVM_PRIVATE_KEY: For private key signer (fallback)
 * - EVM_RPC_URL_BASE, EVM_RPC_URL_BASE_SEPOLIA: RPC URLs
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { defaultSigners } from "./setup.js";
import { createFacilitator } from "@daydreamsai/facilitator";
import { createApp } from "./app.js";
import { createDrizzleAdapter, createTracking } from "./db.js";
import { PostgresResourceTrackingStore } from "@daydreamsai/facilitator/tracking";
import * as trackingSchema from "./schema/tracking.js";

const PORT = parseInt(process.env.PORT || "8090", 10);
const DATABASE_URL = process.env.DATABASE_URL;

// Database setup (optional)
const pool = DATABASE_URL
  ? new pg.Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool
  ? drizzle(pool, { schema: trackingSchema })
  : undefined;
const pgClient = pool ? createDrizzleAdapter(pool) : undefined;

// Resource tracking (falls back to in-memory if no DATABASE_URL)
const tracking = createTracking(pgClient);
if (tracking.store instanceof PostgresResourceTrackingStore) {
  await (tracking.store as PostgresResourceTrackingStore).initialize();
}

// Facilitator + App
const facilitator = createFacilitator({ ...defaultSigners });
const app = createApp({ facilitator, tracking });

app.listen(PORT);
console.log(`x402 Facilitator listening on http://localhost:${PORT}`);
if (DATABASE_URL) {
  console.log(`Resource tracking: PostgreSQL (Drizzle)`);
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
