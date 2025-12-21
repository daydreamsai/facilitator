/**
 * Starknet Client Example - Calls the Starknet paid API using the facilitator
 *
 * Usage:
 *   1. Start the facilitator (Starknet enabled):
 *      STARKNET_NETWORKS=starknet-mainnet,starknet-sepolia \
 *      STARKNET_SPONSOR_ADDRESS=0x... \
 *      bun run dev
 *   2. Start the Starknet API:
 *      STARKNET_PAY_TO=0x... bun run examples/starknetApi.ts
 *   3. Run this client:
 *      STARKNET_ACCOUNT_ADDRESS=0x... \
 *      STARKNET_ACCOUNT_PRIVATE_KEY=0x... \
 *      bun run examples/starknetClient.ts
 *
 * Environment variables:
 *   - BASE_URL: Paid API base URL (default: http://localhost:4024)
 *   - FACILITATOR_URL: Facilitator URL (default: http://localhost:8090)
 *   - STARKNET_ACCOUNT_ADDRESS: Payer account address (required)
 *   - STARKNET_ACCOUNT_PRIVATE_KEY: Payer private key (required)
 *   - STARKNET_RPC_URL: Optional Starknet RPC URL override
 *   - STARKNET_NETWORK: starknet:mainnet | starknet:sepolia (default: starknet:sepolia)
 *   - STARKNET_PAYMASTER_API_KEY: Optional paymaster API key for build calls
 */

import { Account } from "starknet";
import {
  createPaymentPayload,
  decodePaymentRequired,
  encodePaymentSignature,
  decodePaymentResponse,
  DEFAULT_PAYMASTER_ENDPOINTS,
  HTTP_HEADERS,
  createProvider,
  validateNetwork,
  type PaymentRequired,
  type PaymentRequirements,
  type StarknetNetworkId,
} from "x402-starknet";

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4024";
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8090";
const STARKNET_ACCOUNT_ADDRESS = process.env.STARKNET_ACCOUNT_ADDRESS;
const STARKNET_ACCOUNT_PRIVATE_KEY = process.env.STARKNET_ACCOUNT_PRIVATE_KEY;
const STARKNET_RPC_URL = process.env.STARKNET_RPC_URL;
const STARKNET_PAYMASTER_API_KEY = process.env.STARKNET_PAYMASTER_API_KEY;
const DEFAULT_NETWORK = validateNetwork(
  process.env.STARKNET_NETWORK ?? "starknet:sepolia"
) as StarknetNetworkId;

if (!STARKNET_ACCOUNT_ADDRESS || !STARKNET_ACCOUNT_PRIVATE_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    "Set STARKNET_ACCOUNT_ADDRESS and STARKNET_ACCOUNT_PRIVATE_KEY to run."
  );
  process.exit(1);
}

const PATH = "/api/starknet-premium";

type SupportedResponse = {
  kinds?: Array<{
    scheme?: string;
    network?: string;
    extra?: Record<string, unknown>;
  }>;
};

// ============================================================================
// Helpers
// ============================================================================

async function fetchWithPayment(paymentHeader?: string): Promise<Response> {
  return fetch(`${BASE_URL}${PATH}`, {
    headers: paymentHeader
      ? { [HTTP_HEADERS.PAYMENT_SIGNATURE]: paymentHeader }
      : {},
  });
}

async function getPaymentRequired(response: Response): Promise<PaymentRequired> {
  const header = response.headers.get(HTTP_HEADERS.PAYMENT_REQUIRED);
  if (header) {
    return decodePaymentRequired(header);
  }

  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as PaymentRequired | null;
  if (body) {
    return body;
  }

  throw new Error("Missing PAYMENT-REQUIRED response.");
}

function pickRequirement(
  paymentRequired: PaymentRequired,
  preferredNetwork: StarknetNetworkId
): PaymentRequirements {
  const preferred = paymentRequired.accepts.find(
    (requirement) => requirement.network === preferredNetwork
  );
  const first = paymentRequired.accepts[0];

  if (preferred) return preferred;
  if (first) return first;

  throw new Error("No payment options available.");
}

async function resolvePaymasterEndpoint(
  network: StarknetNetworkId
): Promise<string> {
  try {
    const supported = (await fetch(`${FACILITATOR_URL}/supported`).then((res) =>
      res.json()
    )) as SupportedResponse;

    const kind = supported.kinds?.find(
      (candidate) =>
        candidate?.scheme === "exact" && candidate?.network === network
    );

    const extra = kind?.extra as Record<string, unknown> | undefined;
    const endpoint = extra?.paymasterEndpoint;
    if (typeof endpoint === "string" && endpoint.length > 0) {
      return endpoint;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      "Failed to fetch facilitator /supported, using defaults:",
      error
    );
  }

  return DEFAULT_PAYMASTER_ENDPOINTS[network];
}

function ensureTypedData(payload: { typedData?: unknown }): void {
  const typedData = payload.typedData;
  if (typeof typedData !== "object" || typedData === null || Array.isArray(typedData)) {
    throw new Error("Payment payload missing typedData (required).");
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Requesting paid endpoint...");
  let response = await fetchWithPayment();

  if (response.status !== 402) {
    // eslint-disable-next-line no-console
    console.log("Unexpected status:", response.status);
    // eslint-disable-next-line no-console
    console.log(await response.text());
    return;
  }

  const paymentRequired = await getPaymentRequired(response);
  const requirement = pickRequirement(paymentRequired, DEFAULT_NETWORK);
  const paymasterEndpoint = await resolvePaymasterEndpoint(requirement.network);

  const provider = createProvider({
    network: requirement.network,
    ...(STARKNET_RPC_URL ? { rpcUrl: STARKNET_RPC_URL } : {}),
  });

  const account = new Account({
    provider,
    address: STARKNET_ACCOUNT_ADDRESS,
    signer: STARKNET_ACCOUNT_PRIVATE_KEY,
  });

  const payload = await createPaymentPayload(account, 2, requirement, {
    endpoint: paymasterEndpoint,
    network: requirement.network,
    ...(STARKNET_PAYMASTER_API_KEY
      ? { apiKey: STARKNET_PAYMASTER_API_KEY }
      : {}),
  });

  ensureTypedData(payload);

  const paymentHeader = encodePaymentSignature(payload);

  response = await fetchWithPayment(paymentHeader);

  if (!response.ok) {
    // eslint-disable-next-line no-console
    console.error("Paid request failed:", response.status);
    // eslint-disable-next-line no-console
    console.error(await response.text());
    return;
  }

  const result = await response.json();
  // eslint-disable-next-line no-console
  console.log("Paid response:", result);

  const paymentResponse = response.headers.get(HTTP_HEADERS.PAYMENT_RESPONSE);
  if (paymentResponse) {
    const settlement = decodePaymentResponse(paymentResponse);
    // eslint-disable-next-line no-console
    console.log("Settlement:", settlement);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Client failed:", error);
  process.exit(1);
});
