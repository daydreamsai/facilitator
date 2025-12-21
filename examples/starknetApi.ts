/**
 * Starknet Paid API Example - Resource Server using the Facilitator
 *
 * Usage:
 *   1. Start the facilitator (Starknet enabled):
 *      STARKNET_NETWORKS=starknet-mainnet,starknet-sepolia \
 *      STARKNET_SPONSOR_ADDRESS=0x... \
 *      bun run dev
 *   2. Start this server:
 *      STARKNET_PAY_TO=0x... bun run examples/starknetApi.ts
 *
 * Environment variables:
 *   - PORT: Server port (default: 4024)
 *   - FACILITATOR_URL: Facilitator URL (default: http://localhost:8090)
 *   - STARKNET_NETWORK: starknet:mainnet | starknet:sepolia (default: starknet:sepolia)
 *   - STARKNET_PAY_TO: Recipient address for payments (required)
 *   - STARKNET_PRICE: ETH amount for this endpoint (default: 0.0001)
 */

import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { HTTPFacilitatorClient } from "@x402/core/http";
import type {
  PaymentPayload as CorePaymentPayload,
  PaymentRequirements as CorePaymentRequirements,
  SettleResponse as CoreSettleResponse,
} from "@x402/core/types";
import {
  HTTP_HEADERS,
  buildETHPayment,
  encodePaymentRequired,
  encodePaymentResponse,
  decodePaymentSignature,
  validateNetwork,
  type PaymentRequired,
  type StarknetNetworkId,
} from "x402-starknet";

// ============================================================================
// Configuration
// ============================================================================

const PORT = Number(process.env.PORT ?? 4024);
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8090";
const NETWORK = validateNetwork(
  process.env.STARKNET_NETWORK ?? "starknet:sepolia"
) as StarknetNetworkId;
const PAY_TO = process.env.STARKNET_PAY_TO;
const PRICE = Number(process.env.STARKNET_PRICE ?? "0.0001");

if (!PAY_TO) {
  // eslint-disable-next-line no-console
  console.error("Set STARKNET_PAY_TO to run Starknet API example.");
  process.exit(1);
}

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const paymentRequirements = buildETHPayment({
  network: NETWORK,
  amount: PRICE,
  payTo: PAY_TO,
  maxTimeoutSeconds: 120,
});

const facilitatorRequirements: CorePaymentRequirements = {
  ...paymentRequirements,
  extra: paymentRequirements.extra ?? {},
};

function buildPaymentRequired(url: string): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url,
      description: "Starknet premium endpoint",
      mimeType: "application/json",
    },
    accepts: [paymentRequirements],
  };
}

// ============================================================================
// API Server
// ============================================================================

export const app = new Elysia({
  prefix: "/api",
  name: "starknetPaidApi",
  adapter: node(),
}).get("/starknet-premium", async (ctx) => {
  const paymentHeader = ctx.request.headers.get(HTTP_HEADERS.PAYMENT_SIGNATURE);

  if (!paymentHeader) {
    const paymentRequired = buildPaymentRequired(ctx.request.url);
    ctx.set.status = 402;
    ctx.set.headers[HTTP_HEADERS.PAYMENT_REQUIRED] =
      encodePaymentRequired(paymentRequired);
    return paymentRequired;
  }

  let payload: CorePaymentPayload;
  try {
    payload = decodePaymentSignature(paymentHeader) as CorePaymentPayload;
  } catch (error) {
    ctx.set.status = 400;
    return { error: "invalid_payment_payload", details: String(error) };
  }

  const verification = await facilitator.verify(
    payload,
    facilitatorRequirements
  );

  if (!verification.isValid) {
    ctx.set.status = 402;
    return {
      error: "payment_invalid",
      reason: verification.invalidReason,
    };
  }

  const settlement = (await facilitator.settle(
    payload,
    facilitatorRequirements
  )) as CoreSettleResponse;

  if (!settlement.success) {
    ctx.set.status = 502;
    return {
      error: "settlement_failed",
      reason: settlement.errorReason ?? "unknown",
    };
  }

  ctx.set.headers[HTTP_HEADERS.PAYMENT_RESPONSE] = encodePaymentResponse(
    settlement as unknown as CoreSettleResponse
  );

  return {
    ok: true,
    network: settlement.network,
    transaction: settlement.transaction,
  };
});

app.listen(PORT);
// eslint-disable-next-line no-console
console.log(`Starknet API listening on http://localhost:${PORT}`);
