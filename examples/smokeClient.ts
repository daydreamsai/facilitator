/**
 * Smoke Test Client - Tests exact and upto payment schemes
 *
 * Usage:
 *   1. Start the facilitator: bun run dev
 *   2. Start the paid API: bun run examples/paidApi.ts
 *   3. Run this client: CLIENT_EVM_PRIVATE_KEY=0x... bun run examples/smokeClient.ts
 *
 * Environment variables:
 *   - CLIENT_EVM_PRIVATE_KEY: Private key for the payer wallet (required)
 *   - BASE_URL: Paid API URL (default: http://localhost:4022)
 *   - FACILITATOR_URL: Facilitator URL (default: http://localhost:8090)
 *   - RPC_URL: EVM RPC URL (default: EVM_RPC_URL_BASE env var)
 */

import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { registerUptoEvmClientScheme } from "../src/upto/evm/lib.js";

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4022";
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8090";
const CLIENT_EVM_PRIVATE_KEY = process.env.CLIENT_EVM_PRIVATE_KEY;

if (!CLIENT_EVM_PRIVATE_KEY) {
  console.error("Set CLIENT_EVM_PRIVATE_KEY to run smoke client");
  process.exit(1);
}

// ============================================================================
// Setup
// ============================================================================

const account = privateKeyToAccount(CLIENT_EVM_PRIVATE_KEY as `0x${string}`);

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.RPC_URL ?? process.env.EVM_RPC_URL_BASE),
});

// Create x402 client with both exact and upto schemes
const x402 = new x402Client();
registerExactEvmScheme(x402, { signer: account });
const uptoScheme = registerUptoEvmClientScheme(x402, {
  signer: account,
  publicClient,
  facilitatorUrl: FACILITATOR_URL,
});

const httpClient = new x402HTTPClient(x402);

// ============================================================================
// Helpers
// ============================================================================

async function fetchWithPayment(
  path: string,
  paymentHeader?: string
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: paymentHeader ? { "PAYMENT-SIGNATURE": paymentHeader } : {},
  });
}

// ============================================================================
// Exact Scheme Test
// ============================================================================

async function testExactScheme(): Promise<boolean> {
  console.log("\n=== Testing Exact Scheme ===");
  const path = "/api/premium";

  // First request - should get 402
  let res = await fetchWithPayment(path);
  if (res.status !== 402) {
    console.error("Expected 402, got", res.status);
    return false;
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => res.headers.get(name),
    await res
      .clone()
      .json()
      .catch(() => null)
  );

  console.log("Payment required:", {
    scheme: paymentRequired.accepts[0]?.scheme,
    network: paymentRequired.accepts[0]?.network,
    amount: paymentRequired.accepts[0]?.amount,
  });

  // Create payment payload using x402 client
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const headers = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paymentHeader = headers["PAYMENT-SIGNATURE"] || headers["X-PAYMENT"];

  // Retry with payment
  res = await fetchWithPayment(path, paymentHeader);
  if (!res.ok) {
    console.error("Exact payment failed:", res.status, await res.text());
    return false;
  }

  const data = await res.json();
  console.log("Exact scheme response:", data);

  // Check for settlement response
  const txHeader =
    res.headers.get("X-PAYMENT-RESPONSE") ||
    res.headers.get("PAYMENT-RESPONSE");
  if (txHeader) {
    console.log("Settlement header:", txHeader);
  } else {
    console.log(
      "No settlement response header (payment verified, settlement async)"
    );
  }

  return true;
}

// ============================================================================
// Upto Scheme Test
// ============================================================================

async function testUptoScheme(): Promise<boolean> {
  console.log("\n=== Testing Upto Scheme ===");
  const path = "/api/upto-premium";
  let paymentHeader: string | undefined;
  let sessionId: string | undefined;

  // Make a few requests to accrue spend
  for (let i = 0; i < 3; i++) {
    let res = await fetchWithPayment(path, paymentHeader);

    // Handle 402 - need to create/refresh payment
    if (res.status === 402) {
      const paymentRequired = httpClient.getPaymentRequiredResponse(
        (name) => res.headers.get(name),
        await res
          .clone()
          .json()
          .catch(() => null)
      );

      // Check if this is a cap_exhausted or session_closed error
      const body = (await res
        .clone()
        .json()
        .catch(() => ({}))) as { error?: string };
      if (body.error === "cap_exhausted" || body.error === "session_closed") {
        console.log(`Server returned ${body.error}, invalidating permit cache`);
        uptoScheme.invalidatePermit(
          paymentRequired.accepts[0]?.network ?? "eip155:8453",
          paymentRequired.accepts[0]?.asset as `0x${string}`
        );
      }

      // Create payment using the x402 client (handles caching internally)
      const paymentPayload =
        await httpClient.createPaymentPayload(paymentRequired);
      const headers = httpClient.encodePaymentSignatureHeader(paymentPayload);
      paymentHeader = headers["PAYMENT-SIGNATURE"] || headers["X-PAYMENT"];

      // Retry with payment
      res = await fetchWithPayment(path, paymentHeader);
    }

    if (!res.ok) {
      console.error("Request failed:", res.status, await res.text());
      return false;
    }

    sessionId = res.headers.get("x-upto-session-id") ?? sessionId;
    console.log(`Upto response ${i + 1}:`, await res.json());
  }

  if (!sessionId) {
    console.error("No session id returned; did payment succeed?");
    return false;
  }

  console.log("Session ID:", sessionId);

  // Check session status before settlement
  const status1 = await fetch(`${BASE_URL}/api/upto-session/${sessionId}`).then(
    (r) => r.json()
  );
  console.log("Session status (before settle):", status1);

  // Force a final batch settle
  const closeRes = await fetch(`${BASE_URL}/api/upto-close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const closeData = (await closeRes.json()) as {
    success?: boolean;
    status?: string;
    network?: string;
    asset?: string;
  };
  console.log("Close/settle response:", closeData);

  // Invalidate permit cache after successful settlement
  if (closeData.success && closeData.status === "closed" && closeData.network && closeData.asset) {
    console.log("Invalidating permit cache for", closeData.network, closeData.asset);
    uptoScheme.invalidatePermit(closeData.network, closeData.asset as `0x${string}`);
  }

  // Check session status after settlement
  const status2 = await fetch(`${BASE_URL}/api/upto-session/${sessionId}`).then(
    (r) => r.json()
  );
  console.log("Session status (after settle):", status2);

  return true;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=== x402 Smoke Test ===");
  console.log("Payer:", account.address);
  console.log("Base URL:", BASE_URL);
  console.log("Facilitator:", FACILITATOR_URL);

  // Test exact scheme (single payment per request)
  const exactOk = await testExactScheme();
  if (!exactOk) {
    console.error("\n❌ Exact scheme test failed");
    process.exit(1);
  }
  console.log("✅ Exact scheme test passed");

  // Test upto scheme (batched payments)
  const uptoOk = await testUptoScheme();
  if (!uptoOk) {
    console.error("\n❌ Upto scheme test failed");
    process.exit(1);
  }
  console.log("✅ Upto scheme test passed");

  console.log("\n=== All tests passed ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
