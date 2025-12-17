# x402 Facilitator

> **Warning**: This project is currently in alpha. APIs may change without notice and should not be used in production environments without thorough testing.

A production-ready payment settlement service for the [x402 protocol](https://github.com/coinbase/x402). Built with Elysia and Node.js, it verifies cryptographic payment signatures and settles transactions on-chain for EVM (Base) and SVM (Solana) networks.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Custom Signers](#custom-signers)
- [API Reference](#api-reference)
- [Payment Schemes](#payment-schemes)
- [Extending the Facilitator](#extending-the-facilitator)
- [Testing](#testing)
- [Production Deployment](#production-deployment)

## Overview

The x402 Facilitator acts as a trusted intermediary between clients making payments and resource servers providing paid content. It:

1. **Verifies** payment signatures and authorizations
2. **Settles** transactions on-chain (EVM/Solana)
3. **Manages** batched payment sessions for efficient settlement (upto scheme)

### Supported Networks

| Network        | CAIP-2 Identifier                         | Schemes     |
| -------------- | ----------------------------------------- | ----------- |
| Base Mainnet   | `eip155:8453`                             | exact, upto |
| Base Sepolia   | `eip155:84532`                            | exact, upto |
| Ethereum       | `eip155:1`                                | exact, upto |
| Optimism       | `eip155:10`                               | exact, upto |
| Arbitrum       | `eip155:42161`                            | exact, upto |
| Polygon        | `eip155:137`                              | exact, upto |
| Solana Devnet  | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | exact       |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | exact       |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         x402 Facilitator                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   /verify    │    │   /settle    │    │  /supported  │          │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘          │
│         │                   │                                       │
│         ▼                   ▼                                       │
│  ┌─────────────────────────────────────────────────────┐           │
│  │              Payment Scheme Registry                 │           │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │           │
│  │  │ Exact (EVM) │  │ Upto (EVM)  │  │ Exact (SVM) │  │           │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │           │
│  └─────────────────────────────────────────────────────┘           │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                │
│         ▼                    ▼                    ▼                │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐        │
│  │ EVM Signer  │      │ SVM Signer  │      │Session Store│        │
│  │ (Viem/CDP)  │      │(Solana Kit) │      │ (In-Memory) │        │
│  └──────┬──────┘      └──────┬──────┘      └──────┬──────┘        │
│         │                    │                    │                │
└─────────┼────────────────────┼────────────────────┼────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
   │  EVM RPC    │      │ Solana RPC  │      │  Sweeper    │
   └─────────────┘      └─────────────┘      └─────────────┘
```

### Core Components

| Component           | File                          | Responsibility                              |
| ------------------- | ----------------------------- | ------------------------------------------- |
| HTTP Server         | `src/app.ts`                  | Elysia server with endpoints and middleware |
| Facilitator Factory | `src/setup.ts`                | `createFacilitator()` with signer injection |
| Default Signers     | `src/signers/default.ts`      | EVM/SVM wallet from env vars                |
| CDP Signer          | `src/signers/cdp.ts`          | Coinbase Developer Platform adapter         |
| Upto Scheme         | `src/upto/evm/facilitator.ts` | Permit-based batched payments               |
| Session Store       | `src/upto/store.ts`           | In-memory session management                |
| Sweeper             | `src/upto/sweeper.ts`         | Background batch settlement                 |

### Data Flow

**Exact Payment (Immediate Settlement)**

```
Client → POST /verify → Signature validation → VerifyResponse
Client → POST /settle → On-chain transfer → SettleResponse (tx hash)
```

**Upto Payment (Batched Settlement)**

```
Client → POST /verify → Permit validation → Session created/updated
              ↓
         Accumulate pending spend across requests
              ↓
         Sweeper triggers → POST /settle (batch) → Reset pending
```

## Quick Start

### Prerequisites

- Node.js v22+
- EVM private key with Base ETH for gas (or CDP account)
- SVM private key with SOL for fees (optional)

### As a Library

```typescript
import {
  createFacilitator,
  toFacilitatorEvmSigner,
} from "@daydreamsai/facilitator";
import { createCdpEvmSigner } from "@daydreamsai/facilitator/signers/cdp";
import { CdpClient } from "@coinbase/cdp-sdk";

// Using CDP signer (recommended)
const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name: "facilitator" });

const signer = createCdpEvmSigner({
  cdpClient: cdp,
  account,
  network: "base",
  rpcUrl: process.env.EVM_RPC_URL_BASE,
});

const facilitator = createFacilitator({
  evmSigners: [{ signer, networks: "eip155:8453", schemes: ["exact", "upto"] }],
});
```

### From Source

```bash
# Clone and install
git clone https://github.com/daydreamsai/facilitator
cd facilitator
bun install

# Configure environment
cp .env-local .env
# Edit .env with your private keys

# Start development server
bun dev
```

### Verify Installation

```bash
curl http://localhost:8090/supported
```

## Configuration

### Environment Variables

**Default Signer (Private Key)**

| Variable           | Required | Default | Description                        |
| ------------------ | -------- | ------- | ---------------------------------- |
| `EVM_PRIVATE_KEY`  | Yes\*    | -       | Ethereum private key (hex format)  |
| `SVM_PRIVATE_KEY`  | Yes\*    | -       | Solana private key (Base58 format) |
| `PORT`             | No       | `8090`  | Server port                        |
| `EVM_RPC_URL_BASE` | No       | -       | Custom RPC URL for Base            |

\*Required when using default signers. Not needed with CDP signer.

**CDP Signer (Coinbase Developer Platform)**

| Variable             | Required | Default | Description        |
| -------------------- | -------- | ------- | ------------------ |
| `CDP_API_KEY_ID`     | Yes      | -       | CDP API key ID     |
| `CDP_API_KEY_SECRET` | Yes      | -       | CDP API key secret |
| `CDP_WALLET_SECRET`  | Yes      | -       | CDP wallet secret  |

### OpenTelemetry (Optional)

Enable distributed tracing:

```bash
export OTEL_SERVICE_NAME="x402-facilitator"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
```

## Custom Signers

The facilitator supports pluggable signers via the `createFacilitator()` factory.

### Using the Factory

```typescript
import {
  createFacilitator,
  toFacilitatorEvmSigner,
} from "@daydreamsai/facilitator";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Create a viem signer
const account = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`
);
const viemClient = createWalletClient({
  account,
  chain: base,
  transport: http(process.env.EVM_RPC_URL_BASE),
}).extend(publicActions);

const evmSigner = toFacilitatorEvmSigner({
  address: account.address,
  getCode: (args) => viemClient.getCode(args),
  readContract: (args) => viemClient.readContract(args as any),
  writeContract: (args) => viemClient.writeContract(args as any),
  verifyTypedData: (args) => viemClient.verifyTypedData(args as any),
  sendTransaction: (args) => viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args) =>
    viemClient.waitForTransactionReceipt(args),
});

const facilitator = createFacilitator({
  evmSigners: [
    {
      signer: evmSigner,
      networks: ["eip155:8453", "eip155:84532"],
      schemes: ["exact", "upto"],
    },
  ],
  hooks: {
    onAfterSettle: async (ctx) => console.log("Settled:", ctx),
  },
});
```

### CDP Signer (Coinbase Developer Platform)

Use [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) for managed key custody:

```bash
npm install @coinbase/cdp-sdk
```

```typescript
import { createFacilitator } from "@daydreamsai/facilitator";
import { createCdpEvmSigner } from "@daydreamsai/facilitator/signers/cdp";
import { CdpClient } from "@coinbase/cdp-sdk";

// Initialize CDP (uses env vars by default)
const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name: "facilitator" });

// Create signer for Base
const cdpSigner = createCdpEvmSigner({
  cdpClient: cdp,
  account,
  network: "base",
  rpcUrl: process.env.EVM_RPC_URL_BASE,
});

// Create facilitator
const facilitator = createFacilitator({
  evmSigners: [
    { signer: cdpSigner, networks: "eip155:8453", schemes: ["exact", "upto"] },
  ],
});
```

### Multi-Network CDP Setup

```typescript
import { createFacilitator } from "@daydreamsai/facilitator";
import { createMultiNetworkCdpSigners } from "@daydreamsai/facilitator/signers/cdp";

const signers = createMultiNetworkCdpSigners({
  cdpClient: cdp,
  account,
  networks: {
    base: process.env.EVM_RPC_URL_BASE,
    "base-sepolia": process.env.BASE_SEPOLIA_RPC_URL,
    optimism: process.env.OPTIMISM_RPC_URL,
  },
});

const facilitator = createFacilitator({
  evmSigners: [
    { signer: signers.base!, networks: "eip155:8453" },
    { signer: signers["base-sepolia"]!, networks: "eip155:84532" },
    { signer: signers.optimism!, networks: "eip155:10" },
  ],
});
```

### CDP Network Mapping

| CDP Network        | CAIP-2            | Chain ID |
| ------------------ | ----------------- | -------- |
| `base`             | `eip155:8453`     | 8453     |
| `base-sepolia`     | `eip155:84532`    | 84532    |
| `ethereum`         | `eip155:1`        | 1        |
| `ethereum-sepolia` | `eip155:11155111` | 11155111 |
| `optimism`         | `eip155:10`       | 10       |
| `arbitrum`         | `eip155:42161`    | 42161    |
| `polygon`          | `eip155:137`      | 137      |
| `avalanche`        | `eip155:43114`    | 43114    |

## API Reference

### GET /supported

Returns supported payment schemes and networks.

**Response:**

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "eip155:8453" },
    { "x402Version": 2, "scheme": "upto", "network": "eip155:8453" },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    }
  ],
  "signers": {
    "eip155": ["0x..."],
    "solana": ["..."]
  }
}
```

### POST /verify

Validates a payment signature against requirements.

**Request:**

```json
{
  "paymentPayload": {
    "x402Version": 2,
    "resource": { "url": "...", "description": "...", "mimeType": "..." },
    "accepted": {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "1000",
      "payTo": "0x..."
    },
    "payload": { "signature": "0x...", "authorization": {} }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000",
    "payTo": "0x..."
  }
}
```

**Response (Success):**

```json
{ "isValid": true, "payer": "0x..." }
```

**Response (Failure):**

```json
{ "isValid": false, "invalidReason": "invalid_signature" }
```

### POST /settle

Executes on-chain payment settlement.

**Request:** Same as `/verify`

**Response (Success):**

```json
{
  "success": true,
  "transaction": "0x...",
  "network": "eip155:8453",
  "payer": "0x..."
}
```

**Response (Failure):**

```json
{
  "success": false,
  "errorReason": "insufficient_balance",
  "network": "eip155:8453"
}
```

## Payment Schemes

### Exact Scheme

Immediate, single-transaction settlement. Each payment request results in one on-chain transfer.

**Supported tokens:**

- USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- SPL tokens on Solana

### Upto Scheme (Batched Payments)

Permit-based flow for efficient EVM token payments:

1. **Client signs once** - ERC-2612 Permit for a cap amount
2. **Multiple requests** - Reuse the same Permit signature
3. **Automatic batching** - Sweeper settles accumulated spend
4. **Settlement triggers:**
   - Idle timeout (2 minutes of inactivity)
   - Deadline buffer (60 seconds before Permit expires)
   - Cap threshold (90% of cap reached)

**Session Lifecycle:**

```
┌─────────┐     verify      ┌─────────┐     sweep/close     ┌─────────┐
│  None   │ ───────────────▶│  Open   │ ──────────────────▶ │ Closed  │
└─────────┘                 └────┬────┘                     └─────────┘
                                 │ settle
                                 ▼
                            ┌─────────┐
                            │Settling │
                            └────┬────┘
                                 │ success
                                 ▼
                            Back to Open (if cap/deadline allow)
```

**Limitations:**

- ERC-2612 Permit tokens only (not EIP-3009)
- EOA signatures only (no smart wallets/EIP-1271)
- In-memory sessions (lost on restart)

## Extending the Facilitator

### Adding Networks

```typescript
import { createFacilitator } from "@daydreamsai/facilitator";

const facilitator = createFacilitator({
  evmSigners: [
    {
      signer: evmSigner,
      networks: ["eip155:8453", "eip155:10", "eip155:42161"], // Base + Optimism + Arbitrum
      schemes: ["exact", "upto"],
    },
  ],
});
```

### Lifecycle Hooks

Add custom logic at key points:

```typescript
const facilitator = createFacilitator({
  evmSigners: [{ signer, networks: "eip155:8453" }],
  hooks: {
    onBeforeVerify: async (ctx) => {
      // Rate limiting, logging
    },
    onAfterVerify: async (ctx) => {
      // Track verified payments
    },
    onBeforeSettle: async (ctx) => {
      // Validate before settlement
    },
    onAfterSettle: async (ctx) => {
      // Analytics, notifications
    },
    onSettleFailure: async (ctx) => {
      // Alerting, retry logic
    },
  },
});
```

### Custom Session Store

Replace in-memory storage with persistent storage:

```typescript
import type {
  UptoSessionStore,
  UptoSession,
} from "@daydreamsai/facilitator/upto";

class RedisSessionStore implements UptoSessionStore {
  get(id: string): UptoSession | undefined {
    /* Redis get */
  }
  set(id: string, session: UptoSession): void {
    /* Redis set */
  }
  delete(id: string): void {
    /* Redis del */
  }
  entries(): IterableIterator<[string, UptoSession]> {
    /* Redis scan */
  }
}
```

### Custom Signer Adapter

Create adapters for other wallet providers:

```typescript
import { toFacilitatorEvmSigner } from "@daydreamsai/facilitator";

const customSigner = toFacilitatorEvmSigner({
  address: wallet.address,
  getCode: (args) => publicClient.getCode(args),
  readContract: (args) => publicClient.readContract(args),
  writeContract: (args) => wallet.writeContract(args),
  verifyTypedData: (args) => publicClient.verifyTypedData(args),
  sendTransaction: (args) => wallet.sendTransaction(args),
  waitForTransactionReceipt: (args) =>
    publicClient.waitForTransactionReceipt(args),
});
```

## Testing

```bash
# Run tests
bun test

# Watch mode
bun test:watch

# Coverage
bun test:coverage
```

### Smoke Testing

1. Start the facilitator:

   ```bash
   bun dev
   ```

2. Start the demo paid API:

   ```bash
   bun smoke:api
   ```

3. Run the smoke client:
   ```bash
   export CLIENT_EVM_PRIVATE_KEY="0x..."
   bun smoke:upto
   ```

## Production Deployment

### Security Considerations

1. **Private Key Management**
   - Use CDP for managed custody (recommended)
   - Or use secrets managers (AWS Secrets Manager, HashiCorp Vault)
   - Never commit `.env` files with real keys
   - Rotate keys periodically

2. **Network Security**
   - Run behind a reverse proxy (nginx, Cloudflare)
   - Enable TLS/HTTPS
   - Implement rate limiting

3. **Signature Validation**
   - All signatures verified via EIP-712 typed data
   - Permit deadlines enforced with buffer
   - Network/chain ID validation prevents replay attacks

### Scaling

1. **Session Persistence**
   - Replace `InMemoryUptoSessionStore` with Redis/PostgreSQL
   - Required for multi-instance deployments

2. **RPC Resilience**
   - Configure multiple RPC endpoints
   - Implement retry logic with exponential backoff
   - Consider RPC providers with built-in failover

3. **Monitoring**
   - Enable OpenTelemetry tracing
   - Set up alerts for settlement failures
   - Monitor transaction costs and gas prices

### Example Deployment

```yaml
# docker-compose.yml
services:
  facilitator:
    build: .
    environment:
      # Option 1: CDP (recommended)
      - CDP_API_KEY_ID=${CDP_API_KEY_ID}
      - CDP_API_KEY_SECRET=${CDP_API_KEY_SECRET}
      - CDP_WALLET_SECRET=${CDP_WALLET_SECRET}
      # Option 2: Raw private keys
      # - EVM_PRIVATE_KEY=${EVM_PRIVATE_KEY}
      # - SVM_PRIVATE_KEY=${SVM_PRIVATE_KEY}
      - PORT=8090
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
    ports:
      - "8090:8090"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8090/supported"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Network Identifiers

Networks use [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format:

| Network          | Identifier                                |
| ---------------- | ----------------------------------------- |
| Ethereum Mainnet | `eip155:1`                                |
| Base Mainnet     | `eip155:8453`                             |
| Base Sepolia     | `eip155:84532`                            |
| Optimism         | `eip155:10`                               |
| Arbitrum         | `eip155:42161`                            |
| Polygon          | `eip155:137`                              |
| Solana Devnet    | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Solana Mainnet   | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |

## License

MIT
