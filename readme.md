# x402 Facilitator Example

Elysia facilitator service (Node runtime) that verifies and settles payments on-chain for the x402 protocol.

## Prerequisites

- Node.js v20+ (install via [nvm](https://github.com/nvm-sh/nvm))
- pnpm v10 (install via [pnpm.io/installation](https://pnpm.io/installation))
- EVM private key with Base ETH for transaction fees
- SVM private key with Solana Devnet SOL for transaction fees

## Setup

1. Copy `.env-local` to `.env`:

```bash
cp .env-local .env
```

and fill required environment variables:

- `EVM_PRIVATE_KEY` - Ethereum private key
- `SVM_PRIVATE_KEY` - Solana private key
- `PORT` - facilitator server port (optional, defaults to 8090). If you also run `examples/paidApi.ts` on 8090, set this to something else (e.g. 4022).
- `FACILITATOR_URL` (optional) - override the facilitator URL used by `examples/paidApi.ts` (defaults to `http://localhost:$PORT`)

2. Install and build all packages from the typescript examples root:

```bash
cd ../../
pnpm install && pnpm build
cd facilitator
```

3. Run the server:

```bash
pnpm dev
```

### Smoke test client (upto)

This repo includes a tiny client under `examples/smokeClient.ts` to hit the demo upto endpoint and settle a batch.

Start the services in two terminals:

1. Facilitator:

```bash
pnpm dev
```

2. Paid API:

```bash
pnpm smoke:api
```

1. Export a funded EOA private key for the payer:

```bash
export CLIENT_EVM_PRIVATE_KEY="0x..."
```

2. (Optional) set a Base mainnet RPC URL:

```bash
export RPC_URL="https://mainnet.base.org"
```

3. Run the smoke client:

```bash
pnpm smoke:upto
```

The client will:
- call `GET /api/upto-premium` without payment to receive a 402
- sign and cache a Permit for the cap
- make 3 paid requests to accrue spend
- call `POST /api/upto-close` to force a batch settle
- print session state before/after

## OpenTelemetry (optional)

Tracing is enabled via `@elysiajs/opentelemetry` and exports spans using OTLP over HTTP/protobuf.

Set any standard OpenTelemetry env vars, for example:

```bash
export OTEL_SERVICE_NAME="x402-facilitator"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
```

## API Endpoints

### GET /supported

Returns payment schemes and networks this facilitator supports.

```json
{
  "kinds": [
	    {
	      "x402Version": 2,
	      "scheme": "exact",
	      "network": "eip155:8453"
	    },
	    {
	      "x402Version": 2,
	      "scheme": "upto",
	      "network": "eip155:8453"
	    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "extra": {
        "feePayer": "..."
      }
    }
  ],
  "extensions": [],
  "signers": {
    "eip155": ["0x..."],
    "solana": ["..."]
  }
}
```

### POST /verify

Verifies a payment payload against requirements before settlement.

Request:

```json
{
  "paymentPayload": {
    "x402Version": 2,
    "resource": {
      "url": "http://localhost:4021/weather",
      "description": "Weather data",
      "mimeType": "application/json"
    },
	    "accepted": {
	      "scheme": "exact",
	      "network": "eip155:8453",
	      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	      "amount": "1000",
	      "payTo": "0x...",
	      "maxTimeoutSeconds": 300,
	      "extra": {
	        "name": "USD Coin",
	        "version": "2"
	      }
	    },
    "payload": {
      "signature": "0x...",
      "authorization": {}
    }
  },
	  "paymentRequirements": {
	    "scheme": "exact",
	    "network": "eip155:8453",
	    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	    "amount": "1000",
	    "payTo": "0x...",
	    "maxTimeoutSeconds": 300,
	    "extra": {
	      "name": "USD Coin",
	      "version": "2"
	    }
	  }
	}
```

Response (success):

```json
{
  "isValid": true,
  "payer": "0x..."
}
```

Response (failure):

```json
{
  "isValid": false,
  "invalidReason": "invalid_signature"
}
```

### POST /settle

Settles a verified payment by broadcasting the transaction on-chain.

Request body is identical to `/verify`.

Response (success):

```json
	{
	  "success": true,
	  "transaction": "0x...",
	  "network": "eip155:8453",
	  "payer": "0x..."
	}
```

Response (failure):

```json
	{
	  "success": false,
	  "errorReason": "insufficient_balance",
	  "transaction": "",
	  "network": "eip155:8453"
	}
```

## Paywalled demo routes (v2)

This example also includes a tiny paid resource API using `x402ResourceServer` + `x402HTTPResourceServer`
pointing at this facilitator:

- `GET /api/premium` (EVM exact, Base Mainnet)
- `GET /api/premium-solana` (SVM exact, Solana Devnet)
- `GET /api/upto-premium` (EVM upto, Base Mainnet, batched settlement)
- `POST /api/upto-close` (settle an upto session)

Clients should use the v2 stack (`@x402/core` + `@x402/evm|svm` + optionally `@x402/fetch`) to
handle 402 responses, send `PAYMENT-SIGNATURE`, and read `PAYMENT-RESPONSE` (v1 used `X-PAYMENT` / `X-PAYMENT-RESPONSE`).

### Upto scheme (batched payments)

`scheme: "upto"` is a Permit/allowance-based flow for EVM tokens:

1. The resource server returns a 402 with per‑request price in `amount` and a cap in `extra.maxAmountRequired`.
2. The client signs an ERC‑2612 Permit once for that cap, sends it in `PAYMENT-SIGNATURE`, and caches it.
3. Subsequent requests reuse the same cached `PAYMENT-SIGNATURE`. The resource server:
   - verifies the Permit each request via `/verify`
   - tracks spend in an in‑memory session (pending vs settled)
   - allows requests until `settledTotal + pendingSpent + price > cap`
   - returns `x-upto-session-id` on successful requests
4. The server automatically settles a batch by calling facilitator `/settle` once with
   `amount = pendingSpent` when any of these triggers fire:
   - idle timeout (no activity for a while)
   - near Permit deadline
   - near cap threshold (demo uses ~90%)
   After a successful batch, `pendingSpent` resets to 0 and the session stays open
   until cap/deadline are reached.
5. Optional manual close: client may call `POST /api/upto-close` with `{ "sessionId": "..." }`
   to force a final batch and close the session.
   Use `GET /api/upto-session/:id` to inspect session state and see the last receipt.

Notes/limitations:

- Works only for ERC‑2612 Permit tokens (demo assumes USDC on Base Mainnet).  
  It does **not** work for EIP‑3009 “transferWithAuthorization” tokens.
- EOA ECDSA signatures only (no Permit2, no smart‑wallet/EIP‑1271/EIP‑6492 support yet).
- Demo session storage is an in‑memory `Map`; restart loses sessions.
- `maxAmountRequired` and `amount` are in base units (USDC = 6 decimals).

## Extending the Example

### Adding Networks

Register additional schemes for other networks:

```typescript
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { registerExactSvmScheme } from "@x402/svm/exact/facilitator";
import { registerUptoEvmScheme } from "./schemes/upto/evm/registerFacilitator.js";

const facilitator = new x402Facilitator();

registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:8453",
});

registerUptoEvmScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:8453",
});

registerExactSvmScheme(facilitator, {
  signer: svmSigner,
  networks: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
});
```

### Lifecycle Hooks

Add custom logic before/after verify and settle operations:

```typescript
const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    // Log or validate before verification
  })
  .onAfterVerify(async (context) => {
    // Track verified payments
  })
  .onVerifyFailure(async (context) => {
    // Handle verification failures
  })
  .onBeforeSettle(async (context) => {
    // Validate before settlement
    // Return { abort: true, reason: "..." } to cancel
  })
  .onAfterSettle(async (context) => {
    // Track successful settlements
  })
  .onSettleFailure(async (context) => {
    // Handle settlement failures
  });
```

## Network Identifiers

Networks use [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format:

- `eip155:84532` — Base Sepolia
- `eip155:8453` — Base Mainnet
- `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` — Solana Devnet
- `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` — Solana Mainnet
