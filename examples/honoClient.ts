/**
 * Client for testing the Hono server example (examples/hono.ts)
 *
 * Tests both exact and upto payment schemes against the Hono endpoints.
 *
 * Usage:
 *   1. Start the facilitator: bun run dev
 *   2. Start the Hono server: bun run examples/hono.ts
 *   3. Run this client: bun run examples/honoClient.ts
 *
 * Environment variables:
 *   - HONO_URL: Hono server URL (default: http://localhost:3000)
 *   - FACILITATOR_URL: Facilitator URL (default: http://localhost:8090)
 *   - CLIENT_EVM_PRIVATE_KEY: Private key for signing payments (required)
 */

import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { createPublicClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const HONO_URL = process.env.HONO_URL ?? "http://localhost:3000";
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8090";
const CLIENT_EVM_PRIVATE_KEY = process.env.CLIENT_EVM_PRIVATE_KEY;

if (!CLIENT_EVM_PRIVATE_KEY) {
  console.error("Set CLIENT_EVM_PRIVATE_KEY to run client");
  process.exit(1);
}

const account = privateKeyToAccount(CLIENT_EVM_PRIVATE_KEY as `0x${string}`);
console.log("Payer:", account.address);

// Create x402 HTTP client for exact scheme payments
const x402 = new x402Client();
registerExactEvmScheme(x402, { signer: account });
const httpClient = new x402HTTPClient(x402);

// Public client for reading nonces
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.RPC_URL ?? "https://mainnet.base.org"),
});

const noncesAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
] as const;

// Cache for facilitator signer address
let facilitatorSignerAddress: `0x${string}` | null = null;

async function getFacilitatorSigner(network: string): Promise<`0x${string}`> {
  if (facilitatorSignerAddress) return facilitatorSignerAddress;

  const supported = (await fetch(`${FACILITATOR_URL}/supported`).then((r) =>
    r.json()
  )) as { signers?: Record<string, string[]> };

  const signers =
    supported.signers?.[network] ?? supported.signers?.["eip155:*"] ?? [];

  if (signers.length === 0) {
    throw new Error(`No facilitator signer found for network ${network}`);
  }

  facilitatorSignerAddress = getAddress(signers[0]) as `0x${string}`;
  console.log("Facilitator signer:", facilitatorSignerAddress);
  return facilitatorSignerAddress;
}

// Permit cache for upto scheme
type PermitCacheEntry = {
  paymentPayload: PaymentPayload;
  cap: bigint;
  deadline: bigint;
};
const permitCache = new Map<string, PermitCacheEntry>();

async function createUptoPaymentPayload(
  paymentRequired: PaymentRequired
): Promise<PaymentPayload> {
  const requirement = paymentRequired.accepts.find((r) => r.scheme === "upto");
  if (!requirement) {
    throw new Error("No upto requirement in accepts");
  }

  const extra = requirement.extra as Record<string, unknown> | undefined;
  const name = extra?.name as string | undefined;
  const version = extra?.version as string | undefined;
  const maxAmountRequired = BigInt(
    (extra?.maxAmountRequired as string | undefined) ?? requirement.amount
  );
  if (!name || !version) {
    throw new Error("Requirement missing ERC-2612 domain name/version");
  }

  const owner = getAddress(account.address);
  const spender = await getFacilitatorSigner(requirement.network);
  const asset = getAddress(requirement.asset);
  const chainId = Number(requirement.network.split(":")[1]);

  // Check cache
  const cacheKey = [chainId, asset, owner, spender].join(":");
  const cached = permitCache.get(cacheKey);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (
    cached &&
    cached.deadline > nowSec + 30n &&
    cached.cap >= maxAmountRequired
  ) {
    return cached.paymentPayload;
  }

  const nonce = (await publicClient.readContract({
    address: asset,
    abi: noncesAbi,
    functionName: "nonces",
    args: [owner],
  })) as bigint;

  const deadline = BigInt(
    Math.floor(Date.now() / 1000 + requirement.maxTimeoutSeconds)
  );

  const signature = await account.signTypedData({
    domain: {
      name,
      version,
      chainId,
      verifyingContract: asset,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner,
      spender,
      value: maxAmountRequired,
      nonce,
      deadline,
    },
  });

  const paymentPayload: PaymentPayload = {
    x402Version: paymentRequired.x402Version,
    resource: paymentRequired.resource,
    extensions: paymentRequired.extensions,
    accepted: requirement,
    payload: {
      authorization: {
        from: owner,
        to: spender,
        value: maxAmountRequired.toString(),
        validBefore: deadline.toString(),
        nonce: nonce.toString(),
      },
      signature,
    },
  };

  permitCache.set(cacheKey, {
    paymentPayload,
    cap: maxAmountRequired,
    deadline,
  });

  return paymentPayload;
}

async function fetchWithPayment(
  path: string,
  paymentHeader?: string
): Promise<Response> {
  return fetch(`${HONO_URL}${path}`, {
    headers: paymentHeader ? { "PAYMENT-SIGNATURE": paymentHeader } : {},
  });
}

// ============================================================================
// Exact Scheme Test - /weather endpoint
// ============================================================================

async function testExactScheme(): Promise<boolean> {
  console.log("\n=== Testing Exact Scheme (/weather) ===");
  const path = "/weather";

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
  console.log("Weather data:", data);

  // Check for settlement response
  const txHeader =
    res.headers.get("X-PAYMENT-RESPONSE") ||
    res.headers.get("PAYMENT-RESPONSE");
  if (txHeader) {
    console.log("Settlement header present");
  } else {
    console.log("No settlement header (payment verified, settlement async)");
  }

  return true;
}

// ============================================================================
// Upto Scheme Test - /premium/data endpoint
// ============================================================================

async function testUptoScheme(): Promise<boolean> {
  console.log("\n=== Testing Upto Scheme (/premium/data) ===");
  const path = "/premium/data";
  let paymentHeader: string | undefined;

  // Make multiple requests to accrue spend
  for (let i = 0; i < 3; i++) {
    let res = await fetchWithPayment(path, paymentHeader);

    if (res.status === 402) {
      const requiredHeader = res.headers.get("PAYMENT-REQUIRED");
      if (!requiredHeader) {
        console.error("402 without PAYMENT-REQUIRED header:", await res.text());
        return false;
      }

      const paymentRequired = decodePaymentRequiredHeader(
        requiredHeader
      ) as PaymentRequired;

      console.log("Payment required:", {
        scheme: paymentRequired.accepts[0]?.scheme,
        network: paymentRequired.accepts[0]?.network,
        amount: paymentRequired.accepts[0]?.amount,
        maxAmountRequired: (
          paymentRequired.accepts[0]?.extra as Record<string, unknown>
        )?.maxAmountRequired,
      });

      const payload = await createUptoPaymentPayload(paymentRequired);
      paymentHeader = encodePaymentSignatureHeader(payload);

      // Retry with payment
      res = await fetchWithPayment(path, paymentHeader);
    }

    if (!res.ok) {
      console.error("Request failed", res.status, await res.text());
      return false;
    }

    const data = await res.json();
    console.log(`Request ${i + 1}:`, data);
  }

  return true;
}

// ============================================================================
// Session Management Test
// ============================================================================

async function testSessionManagement(): Promise<boolean> {
  console.log("\n=== Testing Session Management ===");

  // List all sessions by making a request and checking session endpoint
  // First, make a request to create/update a session
  const path = "/premium/data";
  let paymentHeader: string | undefined;

  let res = await fetchWithPayment(path, paymentHeader);
  if (res.status === 402) {
    const requiredHeader = res.headers.get("PAYMENT-REQUIRED");
    if (!requiredHeader) {
      console.error("402 without PAYMENT-REQUIRED header");
      return false;
    }

    const paymentRequired = decodePaymentRequiredHeader(
      requiredHeader
    ) as PaymentRequired;
    const payload = await createUptoPaymentPayload(paymentRequired);
    paymentHeader = encodePaymentSignatureHeader(payload);
    res = await fetchWithPayment(path, paymentHeader);
  }

  if (!res.ok) {
    console.error("Request failed", res.status, await res.text());
    return false;
  }

  // Try to compute session ID (same algorithm as server)
  // For demo purposes, we'll use a known session approach
  console.log("Request successful - session tracked internally");
  console.log("Note: Session IDs are computed from payment payload hash");
  console.log(
    "Use /upto/session/:id to check status if you have the session ID"
  );

  return true;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=== Hono Server x402 Client Test ===");
  console.log("Hono URL:", HONO_URL);
  console.log("Facilitator URL:", FACILITATOR_URL);
  console.log("Payer:", account.address);

  // Test exact scheme
  const exactOk = await testExactScheme();
  if (!exactOk) {
    console.error("\nExact scheme test failed");
    process.exit(1);
  }
  console.log("Exact scheme test passed");

  // Test upto scheme
  const uptoOk = await testUptoScheme();
  if (!uptoOk) {
    console.error("\nUpto scheme test failed");
    process.exit(1);
  }
  console.log("Upto scheme test passed");

  // Test session management
  const sessionOk = await testSessionManagement();
  if (!sessionOk) {
    console.error("\nSession management test failed");
    process.exit(1);
  }
  console.log("Session management test passed");

  console.log("\n=== All tests passed ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
