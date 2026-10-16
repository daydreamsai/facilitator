/**
 * Env-gated settle policy for the facilitator server hot path.
 *
 * When configured, registers as createFacilitator({ hooks: { onBeforeSettle } })
 * so /settle can abort before on-chain work. All knobs are optional; unset = no-op
 * (identical to prior behavior).
 *
 * No third-party product dependency — optional SETTLE_PREFLIGHT_URL is a generic
 * HTTP POST any operator can point at their own policy host.
 */

export type SettleHookAbort = {
  abort: true;
  reason: string;
};

export type SettlePolicyContext = {
  paymentPayload?: {
    accepted?: {
      payTo?: string;
      network?: string;
      amount?: string;
      asset?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  requirements?: {
    payTo?: string;
    network?: string;
    amount?: string;
    asset?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type SettlePolicyConfig = {
  /** Max settle amount in native atomic units (string or bigint-compatible). */
  maxAmount?: bigint;
  /** If non-empty, payTo must be in this list. */
  payToAllowlist?: string[];
  /** If non-empty, network must be in this list (exact string match). */
  networkAllowlist?: string[];
  /** Optional generic preflight endpoint. */
  preflightUrl?: string;
  /** Preflight fetch timeout (ms). Default 500. */
  preflightTimeoutMs?: number;
  /**
   * When preflight URL is set and the request fails (network/5xx/timeout),
   * abort settle if true (default). Set SETTLE_PREFLIGHT_FAIL_OPEN=true to allow.
   */
  failClosedOnPreflightError?: boolean;
};

function splitCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseAmount(raw: string | undefined): bigint | undefined {
  if (raw === undefined || raw === "") return undefined;
  try {
    // Atomic units are integers; reject decimals for BigInt safety.
    if (!/^\d+$/.test(raw.trim())) return undefined;
    return BigInt(raw.trim());
  } catch {
    return undefined;
  }
}

/** Normalize EVM addresses for allowlist compare; leave base58/other unchanged. */
function normalizePayTo(payTo: string): string {
  if (payTo.startsWith("0x") || payTo.startsWith("0X")) {
    return payTo.toLowerCase();
  }
  return payTo;
}

export function parseSettlePolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SettlePolicyConfig | null {
  const maxRaw = env.SETTLE_MAX_AMOUNT?.trim();
  const maxAmount = maxRaw ? parseAmount(maxRaw) : undefined;
  if (maxRaw && maxAmount === undefined) {
    throw new Error(
      `SETTLE_MAX_AMOUNT must be a non-negative integer string (atomic units), got: ${maxRaw}`
    );
  }

  const payToAllowlist = splitCsv(env.SETTLE_PAYTO_ALLOWLIST).map(normalizePayTo);
  const networkAllowlist = splitCsv(env.SETTLE_NETWORK_ALLOWLIST);
  const preflightUrl = env.SETTLE_PREFLIGHT_URL?.trim() || undefined;
  const timeoutRaw = env.SETTLE_PREFLIGHT_TIMEOUT_MS?.trim();
  const preflightTimeoutMs = timeoutRaw
    ? Math.max(1, parseInt(timeoutRaw, 10) || 500)
    : 500;
  const failClosedOnPreflightError =
    env.SETTLE_PREFLIGHT_FAIL_OPEN === "true" ? false : true;

  if (
    maxAmount === undefined &&
    payToAllowlist.length === 0 &&
    networkAllowlist.length === 0 &&
    !preflightUrl
  ) {
    return null;
  }

  return {
    maxAmount,
    payToAllowlist: payToAllowlist.length ? payToAllowlist : undefined,
    networkAllowlist: networkAllowlist.length ? networkAllowlist : undefined,
    preflightUrl,
    preflightTimeoutMs,
    failClosedOnPreflightError,
  };
}

export function resolveSettleFields(ctx: SettlePolicyContext): {
  payTo: string;
  network: string;
  amount: string;
  asset: string | undefined;
} {
  const req = ctx.requirements ?? {};
  const accepted = ctx.paymentPayload?.accepted ?? {};
  return {
    payTo: String(req.payTo ?? accepted.payTo ?? ""),
    network: String(req.network ?? accepted.network ?? ""),
    amount: String(req.amount ?? accepted.amount ?? ""),
    asset:
      req.asset !== undefined || accepted.asset !== undefined
        ? String(req.asset ?? accepted.asset)
        : undefined,
  };
}

/**
 * Synchronous local bounds only (max amount, allowlists). Used by tests and
 * as the first stage of the async hook.
 */
export function evaluateLocalSettlePolicy(
  config: SettlePolicyConfig,
  ctx: SettlePolicyContext
): void | SettleHookAbort {
  const { payTo, network, amount } = resolveSettleFields(ctx);

  if (config.maxAmount !== undefined && amount) {
    const amt = parseAmount(amount);
    if (amt === undefined) {
      return {
        abort: true,
        reason: `settle amount is not a valid integer atomic unit: ${amount}`,
      };
    }
    if (amt > config.maxAmount) {
      return {
        abort: true,
        reason: `amount ${amount} exceeds SETTLE_MAX_AMOUNT (${config.maxAmount.toString()})`,
      };
    }
  }

  if (config.payToAllowlist?.length) {
    if (!payTo) {
      return { abort: true, reason: "payTo missing; SETTLE_PAYTO_ALLOWLIST is set" };
    }
    const normalized = normalizePayTo(payTo);
    if (!config.payToAllowlist.includes(normalized)) {
      return {
        abort: true,
        reason: "payTo not in SETTLE_PAYTO_ALLOWLIST",
      };
    }
  }

  if (config.networkAllowlist?.length) {
    if (!network) {
      return {
        abort: true,
        reason: "network missing; SETTLE_NETWORK_ALLOWLIST is set",
      };
    }
    if (!config.networkAllowlist.includes(network)) {
      return {
        abort: true,
        reason: "network not in SETTLE_NETWORK_ALLOWLIST",
      };
    }
  }
}

export type PreflightFetch = (
  url: string,
  init: RequestInit
) => Promise<Response>;

/**
 * Build onBeforeSettle hook. Local bounds first; optional HTTP preflight second.
 */
export function createSettlePolicyHook(
  config: SettlePolicyConfig,
  fetchImpl: PreflightFetch = fetch
): (ctx: SettlePolicyContext) => Promise<void | SettleHookAbort> {
  return async (ctx) => {
    const local = evaluateLocalSettlePolicy(config, ctx);
    if (local && "abort" in local && local.abort) return local;

    if (!config.preflightUrl) return;

    const fields = resolveSettleFields(ctx);
    const controller = new AbortController();
    const timeoutMs = config.preflightTimeoutMs ?? 500;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(config.preflightUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          payTo: fields.payTo,
          network: fields.network,
          amount: fields.amount,
          asset: fields.asset,
        }),
        signal: controller.signal,
      });

      if (res.status === 403) {
        return { abort: true, reason: "preflight denied (HTTP 403)" };
      }

      if (!res.ok) {
        if (config.failClosedOnPreflightError !== false) {
          return {
            abort: true,
            reason: `preflight error HTTP ${res.status}`,
          };
        }
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        allow?: boolean;
        reason?: string;
      };
      if (body.allow === false) {
        return {
          abort: true,
          reason: body.reason?.trim() || "preflight denied",
        };
      }
    } catch (err) {
      if (config.failClosedOnPreflightError !== false) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          abort: true,
          reason: `preflight request failed: ${msg}`,
        };
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
