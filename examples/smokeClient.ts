import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
} from "@x402/core/types";
import { createPublicClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4022";
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8090";
const CLIENT_EVM_PRIVATE_KEY = process.env.CLIENT_EVM_PRIVATE_KEY;

if (!CLIENT_EVM_PRIVATE_KEY) {
  console.error("Set CLIENT_EVM_PRIVATE_KEY to run smoke client");
  process.exit(1);
}

const account = privateKeyToAccount(CLIENT_EVM_PRIVATE_KEY as `0x${string}`);
console.log("payer", account.address);

// Create x402 HTTP client for exact scheme payments
const x402 = new x402Client();
registerExactEvmScheme(x402, { signer: account });
const httpClient = new x402HTTPClient(x402);

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.RPC_URL ?? process.env.EVM_RPC_URL_BASE),
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

  const supported = await fetch(`${FACILITATOR_URL}/supported`).then((r) =>
    r.json()
  ) as { signers?: Record<string, string[]> };

  // Try exact network match first, then wildcard
  const signers =
    supported.signers?.[network] ?? supported.signers?.["eip155:*"] ?? [];
  if (signers.length === 0) {
    throw new Error(`No facilitator signer found for network ${network}`);
  }

  facilitatorSignerAddress = getAddress(signers[0]) as `0x${string}`;
  console.log("Facilitator signer:", facilitatorSignerAddress);
  return facilitatorSignerAddress;
}

type PermitCacheEntry = {
  paymentPayload: PaymentPayload;
  cap: bigint;
  deadline: bigint;
};

const permitCache = new Map<string, PermitCacheEntry>();

async function getCacheKey(req: PaymentRequirements) {
  const chainId = req.network.split(":")[1];
  const facilitator = await getFacilitatorSigner(req.network);
  // Cache key is based on facilitator (spender), not payTo
  // because the permit authorizes the facilitator to spend on our behalf
  return [
    chainId,
    getAddress(req.asset),
    getAddress(account.address),
    facilitator,
  ].join(":");
}

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

  const key = await getCacheKey(requirement);
  const cached = permitCache.get(key);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (
    cached &&
    cached.deadline > nowSec + 30n &&
    cached.cap >= maxAmountRequired
  ) {
    return cached.paymentPayload;
  }

  const owner = getAddress(account.address);
  // IMPORTANT: The spender must be the facilitator (who executes transferFrom),
  // NOT payTo (who receives the payment)
  const spender = await getFacilitatorSigner(requirement.network);
  const asset = getAddress(requirement.asset);
  const chainId = Number(requirement.network.split(":")[1]);

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

  permitCache.set(key, {
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
  return fetch(`${BASE_URL}${path}`, {
    // x402 v2 uses PAYMENT-SIGNATURE (v1 used X-PAYMENT).
    headers: paymentHeader ? { "PAYMENT-SIGNATURE": paymentHeader } : {},
  });
}

// ============================================================================
// Exact Scheme Test
// ============================================================================

async function testExactScheme() {
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
    await res.clone().json().catch(() => null)
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

  // Check for settlement response (optional - may not be present)
  try {
    const settleResponse = httpClient.getPaymentSettleResponse((name) =>
      res.headers.get(name)
    );
    console.log("Settlement response:", settleResponse);
  } catch {
    // Settlement header is optional
    const txHeader = res.headers.get("X-PAYMENT-RESPONSE") || res.headers.get("PAYMENT-RESPONSE");
    if (txHeader) {
      console.log("Settlement header:", txHeader);
    } else {
      console.log("No settlement response header (payment verified, settlement async)");
    }
  }

  return true;
}

// ============================================================================
// Upto Scheme Test
// ============================================================================

async function testUptoScheme() {
  console.log("\n=== Testing Upto Scheme ===");
  const path = "/api/upto-premium";
  let paymentHeader: string | undefined;
  let sessionId: string | undefined;

  // Make a few requests to accrue spend.
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

      const payload = await createUptoPaymentPayload(paymentRequired);
      paymentHeader = encodePaymentSignatureHeader(payload);

      // retry this iteration with payment
      res = await fetchWithPayment(path, paymentHeader);
    }

    if (!res.ok) {
      console.error("Request failed", res.status, await res.text());
      return false;
    }

    sessionId = res.headers.get("x-upto-session-id") ?? sessionId;
    console.log("Upto response", i + 1, await res.json());
  }

  if (!sessionId) {
    console.error("No session id returned; did payment succeed?");
    return false;
  }

  console.log("sessionId", sessionId);

  const status1 = await fetch(`${BASE_URL}/api/upto-session/${sessionId}`).then(
    (r) => r.json()
  );
  console.log("session status (before settle)", status1);

  // Force a final batch settle now (optional; auto-sweeper would do this after idle).
  const closeRes = await fetch(`${BASE_URL}/api/upto-close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  console.log("close settle response", await closeRes.json());

  const status2 = await fetch(`${BASE_URL}/api/upto-session/${sessionId}`).then(
    (r) => r.json()
  );
  console.log("session status (after settle)", status2);

  const paymentResponseHeader = closeRes.headers.get("PAYMENT-RESPONSE");
  if (paymentResponseHeader) {
    console.log(
      "decoded PAYMENT-RESPONSE",
      decodePaymentResponseHeader(paymentResponseHeader)
    );
  }

  return true;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=== x402 Smoke Test ===");
  console.log("Payer:", account.address);

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
