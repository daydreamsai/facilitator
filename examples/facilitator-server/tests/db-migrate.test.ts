import { describe, expect, it } from "bun:test";
import { buildMigrationConfig } from "../src/db-migrate.js";

describe("buildMigrationConfig", () => {
  it("stores drizzle migration metadata in public schema", () => {
    const config = buildMigrationConfig("/tmp/drizzle");

    expect(config.migrationsFolder).toBe("/tmp/drizzle");
    expect(config.migrationsSchema).toBe("public");
  });
});
