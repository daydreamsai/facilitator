/**
 * @daydreamsai/facilitator/upto - Upto (batched payment) scheme components
 *
 * This module exports components for implementing the "upto" payment scheme,
 * which allows batched payments with a pre-authorized spending cap.
 *
 * @example
 * ```typescript
 * import {
 *   InMemoryUptoSessionStore,
 *   createUptoSweeper,
 *   settleUptoSession,
 * } from "@daydreamsai/facilitator/upto";
 *
 * const store = new InMemoryUptoSessionStore();
 * const sweeper = createUptoSweeper({ store, facilitatorClient });
 * ```
 */

// Session store
export {
  InMemoryUptoSessionStore,
  type UptoSessionStore,
  type UptoSession,
  type UptoSessionStatus,
} from "./store.js";

// Settlement
export { settleUptoSession, type UptoFacilitatorClient } from "./settlement.js";

// Sweeper (Elysia plugin for auto-settlement)
export { createUptoSweeper, type UptoSweeperConfig } from "./sweeper.js";
