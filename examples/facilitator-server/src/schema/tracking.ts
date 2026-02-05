/**
 * Drizzle ORM schema for the resource_call_records table.
 *
 * Mirrors the POSTGRES_SCHEMA SQL from @daydreamsai/facilitator/tracking.
 * Use with drizzle-kit for migrations or db.select()/db.insert() for typed queries.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

export const resourceCallRecords = pgTable("resource_call_records", {
  id: uuid("id").primaryKey(),
  method: varchar("method", { length: 10 }).notNull(),
  path: text("path").notNull(),
  routeKey: text("route_key").notNull(),
  url: text("url").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),

  paymentRequired: boolean("payment_required").notNull(),
  paymentVerified: boolean("payment_verified").notNull(),
  verificationError: text("verification_error"),

  payment: jsonb("payment"),
  settlement: jsonb("settlement"),
  uptoSession: jsonb("upto_session"),

  responseStatus: integer("response_status").notNull().default(0),
  responseTimeMs: integer("response_time_ms").notNull().default(0),
  handlerExecuted: boolean("handler_executed").notNull().default(false),

  request: jsonb("request").notNull(),
  routeConfig: jsonb("route_config"),
  metadata: jsonb("metadata"),
});
