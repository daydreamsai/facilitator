import { Elysia } from "elysia";
import { x402ResourceServer } from "@x402/core/server";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  type HTTPAdapter,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { UptoEvmServerScheme } from "../src/schemes/upto/evm/server.js";
import { createHash } from "node:crypto";
import type { PaymentPayload } from "@x402/core/types";

import { evmAccount, svmAccount } from "../src/signers.js";
import { settleUptoSession } from "../src/upto/settlement.js";
import { InMemoryUptoSessionStore, type UptoSession } from "../src/upto/sessionStore.js";
import { node } from "@elysiajs/node";

const FACILITATOR_URL =
  process.env.FACILITATOR_URL ??
  `http://localhost:${process.env.FACILITATOR_PORT ?? process.env.PORT ?? "4022"}`;

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const uptoStore = new InMemoryUptoSessionStore();

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:*", new ExactEvmScheme())
  .register("eip155:*", new UptoEvmServerScheme())
  .register("solana:*", new ExactSvmScheme());

await resourceServer.initialize();

const routes = {
  "GET /api/premium": {
    accepts: {
      scheme: "exact",
      network: "eip155:8453",
      payTo: evmAccount.address,
      price: "$0.01",
    },
    description: "Premium demo endpoint",
    mimeType: "application/json",
  },
  "GET /api/premium-solana": {
    accepts: {
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      payTo: svmAccount.address,
      price: "$0.01",
    },
    description: "Premium demo endpoint (Solana)",
    mimeType: "application/json",
  },
  "GET /api/upto-premium": {
    accepts: {
      scheme: "upto",
      network: "eip155:8453",
      payTo: evmAccount.address,
      // NOTE: `PaymentOption.extra` is not currently propagated into `PaymentRequirements.extra`
      // by `@x402/core`'s HTTP helper, so we attach the cap to `price.extra` instead.
      // Per-request: $0.01 (USDC 6 decimals = 10_000). Cap: $0.05 (50_000).
      price: {
        amount: "10000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        extra: {
          name: "USD Coin",
          version: "2",
          maxAmountRequired: "50000",
        },
      },
    },
    description: "Premium demo endpoint (upto / batched)",
    mimeType: "application/json",
  },
} as const;

const httpServer = new x402HTTPResourceServer(resourceServer, routes);

const X402_RESULT = Symbol.for("x402.http.process.result");

function getUptoSessionId(paymentPayload: PaymentPayload): string {
  const p: any = paymentPayload.payload ?? {};
  const auth: any = p.authorization ?? {};
  const key = {
    network: paymentPayload.accepted.network,
    asset: paymentPayload.accepted.asset,
    owner: auth.from,
    spender: auth.to,
    cap: auth.value,
    nonce: auth.nonce,
    deadline: auth.validBefore,
    signature: p.signature,
  };

  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

function createAdapter(ctx: { request: Request; body: unknown }): HTTPAdapter {
  const url = new URL(ctx.request.url);
  const queryParams: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams.entries()) {
    const existing = queryParams[key];
    if (existing === undefined) {
      queryParams[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      queryParams[key] = [existing, value];
    }
  }

  return {
    getHeader: (name: string) => ctx.request.headers.get(name) ?? undefined,
    getMethod: () => ctx.request.method,
    getPath: () => url.pathname,
    getUrl: () => ctx.request.url,
    getAcceptHeader: () => ctx.request.headers.get("accept") ?? "",
    getUserAgent: () => ctx.request.headers.get("user-agent") ?? "",
    getQueryParams: () => queryParams,
    getQueryParam: (name: string) => queryParams[name],
    getBody: () => ctx.body,
  };
}

export const app = new Elysia({
  prefix: "/api",
  name: "paidApi",
  adapter: node(),
})
  .onBeforeHandle(async (ctx) => {
    const adapter = createAdapter(ctx);
    const result = await httpServer.processHTTPRequest({
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
      paymentHeader: adapter.getHeader("x-payment"),
    });

    (ctx.request as any)[X402_RESULT] = result;

    if (result.type === "payment-error") {
      ctx.set.status = result.response.status;
      ctx.set.headers = { ...ctx.set.headers, ...result.response.headers };
      return result.response.body;
    }

    if (result.type === "payment-verified") {
      const requirements = result.paymentRequirements;

      if (requirements.scheme === "upto") {
        const sessionId = getUptoSessionId(result.paymentPayload);
        const payloadAny: any = result.paymentPayload.payload;
        const authAny: any = payloadAny?.authorization;

        const cap = BigInt(authAny?.value ?? "0");
        const deadline = BigInt(authAny?.validBefore ?? "0");
        const price = BigInt(requirements.amount);

        const existing =
          uptoStore.get(sessionId) ??
          ({
            cap,
            pendingSpent: 0n,
            settledTotal: 0n,
            deadline,
            lastActivityMs: Date.now(),
            status: "open",
            paymentPayload: result.paymentPayload,
            paymentRequirements: requirements,
          } as UptoSession);

        if (existing.status === "settling") {
          ctx.set.status = 409;
          ctx.set.headers["content-type"] = "application/json";
          return {
            error: "settling_in_progress",
            message: "Session is settling a batch, retry shortly.",
            sessionId,
          };
        }

        if (existing.status === "closed") {
          ctx.set.status = 402;
          ctx.set.headers["content-type"] = "application/json";
          return {
            error: "session_closed",
            message: "Session closed. Reauthorize a new upto cap.",
            sessionId,
          };
        }

        const nextTotal = existing.settledTotal + existing.pendingSpent + price;

        if (nextTotal > existing.cap) {
          ctx.set.status = 402;
          ctx.set.headers["content-type"] = "application/json";
          return {
            error: "cap_exhausted",
            message: "Upto cap exhausted, reauthorize with higher max.",
            sessionId,
          };
        }

        existing.pendingSpent += price;
        existing.lastActivityMs = Date.now();
        existing.paymentPayload = result.paymentPayload;
        existing.paymentRequirements = requirements;
        uptoStore.set(sessionId, existing);

        ctx.set.headers["x-upto-session-id"] = sessionId;
      }
    }
  })
  .onAfterHandle(async (ctx) => {
    const result = (ctx.request as any)[X402_RESULT];
    if (result?.type !== "payment-verified") return;

    if (result.paymentRequirements.scheme === "upto") {
      // Upto settles in batch via /api/upto-close
      return;
    }

    const settlement = await httpServer.processSettlement(
      result.paymentPayload,
      result.paymentRequirements
    );

    if (settlement.success) {
      ctx.set.headers = { ...ctx.set.headers, ...settlement.headers };
    } else {
      console.error("Settlement failed:", settlement.errorReason);
    }
  })
  .get("/premium", () => ({ message: "premium content (evm)" }))
  .get("/premium-solana", () => ({ message: "premium content (solana)" }))
  .get("/upto-premium", () => ({ message: "premium content (upto evm)" }))
  .get("/upto-session/:id", ({ params }) => {
    const session = uptoStore.get(params.id);
    if (!session) return { error: "unknown_session" };

    return {
      id: params.id,
      status: session.status,
      cap: session.cap.toString(),
      settledTotal: session.settledTotal.toString(),
      pendingSpent: session.pendingSpent.toString(),
      deadline: session.deadline.toString(),
      lastActivityMs: session.lastActivityMs,
      lastSettlement: session.lastSettlement,
    };
  })
  .post("/upto-close", async ({ body, status }) => {
    const { sessionId } = body as { sessionId?: string };
    if (!sessionId) {
      return status(400, { error: "missing_session_id" });
    }

    const session = uptoStore.get(sessionId);
    if (!session) {
      return status(404, { error: "unknown_session" });
    }

    await settleUptoSession(
      uptoStore,
      facilitatorClient,
      sessionId,
      "manual_close",
      true
    );

    return (
      uptoStore.get(sessionId)?.lastSettlement?.receipt ?? {
        success: true,
        transaction: "",
        network: session.paymentPayload.accepted.network,
      }
    );
  });

app.listen(4022);
console.log(`Paid API listening on http://localhost:4022 (facilitator: ${FACILITATOR_URL})`);
