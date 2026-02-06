/**
 * Reusable migration function for server startup.
 * Safe to call on every startup -- already-applied migrations are skipped.
 */

import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  const db = drizzle(pool);
  const migrationsFolder = resolve(__dirname, "../drizzle");
  await migrate(db, { migrationsFolder });
}
