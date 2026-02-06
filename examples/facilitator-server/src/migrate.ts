#!/usr/bin/env node
/**
 * Standalone migration runner for the facilitator database.
 *
 * Usage:
 *   bun run src/migrate.ts
 *   bun run db:migrate
 *
 * Requires DATABASE_URL environment variable.
 */

import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required for migrations");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

console.log("Running migrations...");
await migrate(db, { migrationsFolder: resolve(__dirname, "../drizzle") });
console.log("Migrations complete.");

await pool.end();
