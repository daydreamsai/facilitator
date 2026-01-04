import { Elysia } from "elysia";
import type { UptoSessionStore } from "./store.js";
import { settleUptoSession, type UptoFacilitatorClient } from "./settlement.js";

export interface UptoSweeperConfig {
  store: UptoSessionStore;
  facilitatorClient: UptoFacilitatorClient;
  idleSettleMs?: number;
  longIdleCloseMs?: number;
  deadlineBufferSec?: number;
  capThresholdNum?: bigint;
  capThresholdDen?: bigint;
  intervalMs?: number;
}

export function createUptoSweeper(config: UptoSweeperConfig) {
  const idleSettleMs = config.idleSettleMs ?? 2 * 60 * 1000;
  const longIdleCloseMs = config.longIdleCloseMs ?? 30 * 60 * 1000;
  const deadlineBufferSec = config.deadlineBufferSec ?? 60;
  const capThresholdNum = config.capThresholdNum ?? 9n;
  const capThresholdDen = config.capThresholdDen ?? 10n;
  const intervalMs = config.intervalMs ?? 30 * 1000;

  let interval: NodeJS.Timeout | undefined;

  const sweep = () => {
    const nowMs = Date.now();
    const nowSec = BigInt(Math.floor(nowMs / 1000));

    for (const [id, session] of config.store.entries()) {
      if (session.status === "settling") continue;

      const idleMs = nowMs - session.lastActivityMs;
      const timeToDeadline = session.deadline - nowSec;
      const totalOutstanding = session.settledTotal + session.pendingSpent;

      if (session.status === "open" && session.pendingSpent > 0n) {
        if (idleMs >= idleSettleMs) {
          void settleUptoSession(
            config.store,
            config.facilitatorClient,
            id,
            "idle_timeout",
            false,
            deadlineBufferSec
          );
          continue;
        }

        if (timeToDeadline <= BigInt(deadlineBufferSec)) {
          void settleUptoSession(
            config.store,
            config.facilitatorClient,
            id,
            "deadline_buffer",
            true,
            deadlineBufferSec
          );
          continue;
        }

        if (
          totalOutstanding * capThresholdDen >=
          session.cap * capThresholdNum
        ) {
          void settleUptoSession(
            config.store,
            config.facilitatorClient,
            id,
            "cap_threshold",
            false,
            deadlineBufferSec
          );
          continue;
        }
      }

      if (
        idleMs >= longIdleCloseMs ||
        timeToDeadline <= 0n ||
        session.settledTotal >= session.cap
      ) {
        if (session.pendingSpent > 0n && session.status === "open") {
          void settleUptoSession(
            config.store,
            config.facilitatorClient,
            id,
            "auto_close",
            true,
            deadlineBufferSec
          );
        } else {
          session.status = "closed";
          config.store.set(id, session);
          if (idleMs >= longIdleCloseMs) config.store.delete(id);
        }
      }
    }
  };

  return new Elysia({ name: "upto.sweeper" })
    .onStart(() => {
      interval = setInterval(sweep, intervalMs);
    })
    .onStop(() => {
      if (interval) clearInterval(interval);
    });
}
