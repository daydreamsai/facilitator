import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { createHash } from "node:crypto";

import { evmAccount, svmAccount } from "../src/signers/index.js";
import {
  createResourceServer,
  HTTPFacilitatorClient,
  UptoEvmServerScheme,
} from "@daydreamsai/facilitator";
import {
  InMemoryUptoSessionStore,
  settleUptoSession,
  type UptoSession,
} from "@daydreamsai/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

const facilitatorUrl = process.env.FACILITATOR_URL ?? "http://localhost:8090";
const evmAddress = evmAccount.address;

const app = new Hono();

// Facilitator client for verification and settlement
const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

// Create resource server with all Daydreams schemes pre-registered
const resourceServer = createResourceServer(facilitatorClient);

resourceServer.initialize();

// Session store for upto scheme batched payments
const uptoStore = new InMemoryUptoSessionStore();

// Helper to generate session ID from payment payload
function getUptoSessionId(paymentPayload: PaymentPayload): string {
  const p = paymentPayload.payload as Record<string, unknown>;
  const auth = (p?.authorization ?? {}) as Record<string, unknown>;
  const key = {
    network: paymentPayload.accepted.network,
    asset: paymentPayload.accepted.asset,
    owner: auth.from,
    spender: auth.to,
    cap: auth.value,
    nonce: auth.nonce,
    deadline: auth.validBefore,
    signature: p?.signature,
  };
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

// Helper to track upto session from verification result
function trackUptoSession(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements
): { sessionId: string; error?: string } {
  const sessionId = getUptoSessionId(paymentPayload);
  const auth = (paymentPayload.payload as Record<string, unknown>)
    ?.authorization as Record<string, unknown>;

  const cap = BigInt((auth?.value as string) ?? "0");
  const deadline = BigInt((auth?.validBefore as string) ?? "0");
  const price = BigInt(requirements.amount ?? "0");

  const existing =
    uptoStore.get(sessionId) ??
    ({
      cap,
      pendingSpent: 0n,
      settledTotal: 0n,
      deadline,
      lastActivityMs: Date.now(),
      status: "open",
      paymentPayload,
      paymentRequirements: requirements,
    } as UptoSession);

  // Check session status
  if (existing.status === "settling") {
    return { sessionId, error: "settling_in_progress" };
  }
  if (existing.status === "closed") {
    return { sessionId, error: "session_closed" };
  }

  // Check cap
  const nextTotal = existing.settledTotal + existing.pendingSpent + price;
  if (nextTotal > existing.cap) {
    return { sessionId, error: "cap_exhausted" };
  }

  // Update session
  existing.pendingSpent += price;
  existing.lastActivityMs = Date.now();
  existing.paymentPayload = paymentPayload;
  existing.paymentRequirements = requirements;
  uptoStore.set(sessionId, existing);

  return { sessionId };
}

// Register hook to track upto sessions after verification
resourceServer.onAfterVerify(async (ctx) => {
  if (ctx.requirements.scheme !== "upto") return;
  if (!ctx.result.isValid) return;

  // Track the session (errors are logged but don't block the request)
  const { sessionId, error } = trackUptoSession(
    ctx.paymentPayload,
    ctx.requirements
  );
  if (error) {
    console.warn(`Upto session ${sessionId} error: ${error}`);
  }
});

// ============================================================================
// Routes
// ============================================================================

// Apply payment middleware globally - it will only intercept routes defined in config
app.use(
  paymentMiddleware(
    {
      // Exact scheme - immediate settlement per request
      "GET /weather": {
        accepts: {
          scheme: "exact",
          price: "$0.001",
          network: "eip155:8453", // Base mainnet
          payTo: evmAddress,
        },
        description: "Weather data",
        mimeType: "application/json",
      },
      // Upto scheme - batched settlement
      "GET /premium/data": {
        accepts: {
          scheme: "upto",
          network: "eip155:8453", // Base mainnet
          payTo: evmAddress,
          price: {
            amount: "1000", // $0.001 per request
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base mainnet
            extra: {
              name: "USD Coin",
              version: "2",
              maxAmountRequired: "10000", // $0.01 cap
            },
          },
        },
        description: "Premium data with batched payments",
        mimeType: "application/json",
      },
    },
    resourceServer,
    undefined, // paywallConfig
    undefined, // paywall
    false // syncFacilitatorOnStart - skip validation on startup
  )
);

// Route handlers
app.get("/weather", (c) => c.json({ weather: "sunny", temperature: 70 }));
app.get("/premium/data", (c) => c.json({ data: "premium content" }));

// Session status endpoint
app.get("/upto/session/:id", (c) => {
  const session = uptoStore.get(c.req.param("id"));
  if (!session) return c.json({ error: "unknown_session" }, 404);

  return c.json({
    id: c.req.param("id"),
    status: session.status,
    cap: session.cap.toString(),
    settledTotal: session.settledTotal.toString(),
    pendingSpent: session.pendingSpent.toString(),
    deadline: session.deadline.toString(),
  });
});

// Manual close/settle endpoint
app.post("/upto/close", async (c) => {
  const { sessionId } = await c.req.json<{ sessionId?: string }>();
  if (!sessionId) return c.json({ error: "missing_session_id" }, 400);

  const session = uptoStore.get(sessionId);
  if (!session) return c.json({ error: "unknown_session" }, 404);

  await settleUptoSession(
    uptoStore,
    facilitatorClient,
    sessionId,
    "manual_close",
    true
  );

  return c.json(
    uptoStore.get(sessionId)?.lastSettlement?.receipt ?? { success: true }
  );
});

export default app;
