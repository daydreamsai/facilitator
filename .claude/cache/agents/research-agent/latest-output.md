# Research Report: x402 Protocol from Coinbase

Generated: 2026-02-05

## Executive Summary

x402 is an open standard for internet-native payments built on HTTP, enabling seamless integration of cryptocurrency payments into web services. The protocol uses the HTTP 402 "Payment Required" status code to facilitate payments between clients, resource servers, and facilitators across multiple blockchain networks (EVM, Solana, Starknet). The Columbus codebase is an implementation of an x402 facilitator with extended support for batched payments (upto scheme).

## Research Question

What is the x402 protocol, how do facilitators and resources work, and what payment flows exist?

---

## Key Findings

### Finding 1: Protocol Overview and Core Concepts

x402 is an open standard that enables internet-native payments through HTTP. It supports multiple blockchain networks (crypto) and forms of value (stablecoins, tokens, fiat).

**Six Foundational Principles:**
1. **Open Standard** - Freely accessible and vendor-agnostic
2. **HTTP Native** - Complements existing HTTP infrastructure without extra requests
3. **Network Agnostic** - Supports multiple blockchains with onchain priority
4. **Backwards Compatible** - Existing network support won't be deprecated
5. **Trust Minimizing** - Facilitators cannot move funds except per client intent
6. **User-Friendly** - Abstracts cryptocurrency complexity

**Current Version:** 2 (with v1 backwards compatibility)

- Source: https://github.com/coinbase/x402 README and specification

### Finding 2: Four Ecosystem Participants

The x402 ecosystem consists of four primary components:

| Component | Definition |
|-----------|------------|
| **Client** | An entity seeking to pay for a resource (human or AI agent) |
| **Resource Server** | The HTTP server providing the API or resource |
| **Facilitator** | A server verifying and executing payments across networks |
| **Resource** | Any internet-accessible service accepting HTTP/HTTPS requests (webpages, APIs, RPC services, file servers) |

- Source: x402 specification v2, core-concepts docs

### Finding 3: What is a Facilitator?

A facilitator is an **optional service** that performs two critical functions:

1. **Verification (`POST /verify`)** - Validates client-submitted payment payloads against server requirements without blockchain execution
2. **Settlement (`POST /settle`)** - Executes verified payments through blockchain transaction broadcast

**Key Characteristics:**
- **Non-custodial** - Does not hold funds; only processes signed payloads
- Reduces operational complexity for resource servers
- Enables faster integration without blockchain development expertise

**Facilitator API Endpoints:**

```
POST /verify
Request: { paymentPayload, paymentRequirements }
Response: { isValid: boolean, payer: string, invalidReason?: string }

POST /settle
Request: { paymentPayload, paymentRequirements }
Response: { success: boolean, payer: string, transaction: string, network: string, errorReason?: string }

GET /supported
Response: { kinds: [...], extensions: [], signers: {...} }
```

- Source: x402 specification v2, `/docs/core-concepts/facilitator.md`

### Finding 4: How Resources are Defined and Accessed

Resources are "paid resources" that servers monetize through the protocol. They are defined using **RouteConfig** objects that specify payment requirements.

**Resource Definition Structure:**

```typescript
{
  accepts: {
    scheme: "exact" | "upto",
    network: "eip155:8453",  // CAIP-2 format
    payTo: "0x...",
    price: "$0.01" | { amount, asset, extra }
  },
  description: "Premium content",
  mimeType: "application/json"
}
```

**ResourceInfo in PaymentRequired response:**
- `url` - Protected resource location
- `description` - Human-readable details
- `mimeType` - Expected response format

**Routes Configuration:**
Routes are registered with patterns like `"GET /api/premium"` mapped to payment configurations. The Columbus codebase uses framework-specific middleware (Elysia, Hono, Express) that intercepts requests and enforces payment.

- Source: Columbus codebase `/packages/core/src/elysia/paidRoutes.ts`, x402 specification

### Finding 5: Payment Flows (Exact vs Upto)

**12-Step Exact Payment Flow:**

1. Client initiates HTTP request to resource server
2. Server responds with `402 Payment Required` + `PAYMENT-REQUIRED` header
3. Client selects payment option and creates PaymentPayload (signs authorization)
4. Client sends request with `PAYMENT-SIGNATURE` header
5. Server verifies payload locally or via facilitator's `/verify`
6. Facilitator validates signature, balance, time window, nonce
7. Server performs work if valid; returns 402 if invalid
8. Server settles via facilitator's `/settle` or directly
9. Facilitator submits transaction to blockchain
10. Facilitator awaits blockchain confirmation
11. Facilitator returns settlement response
12. Server returns `200 OK` with `PAYMENT-RESPONSE` header

**Exact Scheme (Immediate Settlement):**
- Uses EIP-3009 (Transfer with Authorization) for EVM
- Uses TransferChecked for Solana SPL tokens
- Single transaction per request
- Payment happens immediately

**Upto Scheme (Batched Settlement):**
- Uses ERC-2612 permits for EVM only
- Client signs a permit for a maximum amount
- Multiple requests aggregate to a session
- Settlement happens periodically via "sweeper"
- More efficient for high-frequency micropayments

**Upto Session Lifecycle:**
```
1. Client signs permit (maxAmountRequired)
2. Each request accumulates usage
3. Sweeper periodically settles active sessions
4. Session closes when cap exhausted or manually closed
```

- Source: x402 specification, Columbus `/packages/core/src/upto/` modules

### Finding 6: Resource Server Interaction with Facilitator

The resource server uses a **FacilitatorClient** to communicate with the facilitator:

```typescript
// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({
  url: "http://localhost:8090"
});

// Create resource server with schemes
const resourceServer = createResourceServer(facilitatorClient, {
  exactEvm: true,
  uptoEvm: true,
  exactSvm: true
});

// Wrap with HTTP processing
const httpServer = new x402HTTPResourceServer(resourceServer, routes);
```

**Middleware Processing Flow:**

```typescript
// 1. Before handler
const result = await httpServer.processHTTPRequest({
  adapter,
  path,
  method
}, paywallConfig);

// 2. If payment-error, return 402
// 3. If payment-verified with upto, track session
// 4. Call route handler
// 5. After handler - settle if autoSettle enabled
await httpServer.processSettlement(paymentPayload, paymentRequirements);
```

- Source: Columbus `/packages/core/src/middleware/core.ts`, `/packages/core/src/server.ts`

### Finding 7: HTTP Headers and Data Structures

**Request Headers:**
- `PAYMENT-SIGNATURE` - Base64-encoded PaymentPayload
- `X-PAYMENT` (v1 legacy)

**Response Headers:**
- HTTP `402 Payment Required` status
- `PAYMENT-REQUIRED` - Base64-encoded payment options
- `PAYMENT-RESPONSE` - Base64-encoded settlement confirmation

**PaymentRequired Schema:**
```typescript
{
  x402Version: 2,
  error?: string,          // Why payment is required
  resource: {
    url: string,
    description: string,
    mimeType: string
  },
  accepts: PaymentRequirements[],
  extensions?: object
}
```

**PaymentPayload Schema:**
```typescript
{
  x402Version: 2,
  resource?: ResourceInfo,
  accepted: PaymentRequirements,  // Chosen option
  payload: {                      // Scheme-specific
    signature: string,
    authorization: { from, to, value, validAfter, validBefore, nonce }
  },
  extensions?: object
}
```

**SettlementResponse Schema:**
```typescript
{
  success: boolean,
  errorReason?: string,
  payer: string,
  transaction: string,    // Blockchain tx hash
  network: string         // CAIP-2 format
}
```

- Source: x402 specification v2

### Finding 8: Network Identifiers (CAIP-2 Format)

Networks use `namespace:reference` format:

| Network | CAIP-2 ID |
|---------|-----------|
| Base Mainnet | `eip155:8453` |
| Base Sepolia | `eip155:84532` |
| Ethereum Mainnet | `eip155:1` |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |

**Wildcard Registration:**
Schemes can register with wildcards like `eip155:*` or `solana:*` to handle entire blockchain families.

- Source: x402 specification, Columbus networks.ts

### Finding 9: Security Mechanisms

**Replay Attack Prevention:**
1. **EIP-3009 Nonce** - Unique 32-byte nonce per authorization
2. **Blockchain-level** - Smart contract prevents nonce reuse
3. **Time Constraints** - validAfter/validBefore bounds
4. **Cryptographic Signing** - All authorizations require payer signature

**Exact EVM Verification Steps:**
1. Validate EIP-712 signature authenticity
2. Confirm sufficient payer token balance
3. Ensure payment amount meets requirements
4. Verify authorization is within valid time range
5. Match authorization parameters to requirements
6. Simulate transaction execution

- Source: x402 specification v2

---

## Codebase Analysis (Columbus Facilitator)

### Architecture Overview

```
packages/core/          # @daydreamsai/facilitator
  src/
    factory.ts          # createFacilitator() - main entry point
    server.ts           # createResourceServer() - resource server factory
    middleware/core.ts  # Shared payment processing logic
    elysia/            # Elysia framework integration
    hono/              # Hono framework integration
    express/           # Express framework integration
    upto/              # Upto scheme (batched payments)
    starknet/          # Starknet support
    signers/           # CDP, private key signers

examples/
  facilitator-server/   # Running facilitator server
  paidApi.ts           # Example resource server
```

### Key Components

**createFacilitator()** - Factory that creates an x402Facilitator with:
- EVM signer configurations
- SVM signer configurations
- Starknet configurations
- Lifecycle hooks (onBeforeVerify, onAfterSettle, etc.)

**createResourceServer()** - Creates x402ResourceServer with:
- ExactEvmScheme (immediate EVM payments)
- UptoEvmServerScheme (batched EVM payments)
- ExactSvmScheme (immediate Solana payments)

**createElysiaPaidRoutes()** - Creates paid route builder for Elysia with:
- Automatic middleware attachment
- Route-level payment configuration
- Paywall provider for browser UI

### Example Resource Definition

```typescript
createElysiaPaidRoutes(app, {
  middleware: { resourceServer, upto, paywallProvider }
})
.get("/premium", () => ({ message: "premium content" }), {
  payment: {
    accepts: {
      scheme: "exact",
      network: "eip155:8453",
      payTo: "0x...",
      price: "$0.01"
    },
    description: "Premium content",
    mimeType: "application/json"
  }
});
```

---

## Sources

- [x402 GitHub Repository](https://github.com/coinbase/x402)
- [x402 Specification v2](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md)
- [Facilitator Core Concept](https://github.com/coinbase/x402/blob/main/docs/core-concepts/facilitator.md)
- [Client-Server Interaction](https://github.com/coinbase/x402/blob/main/docs/core-concepts/client-server.md)
- Columbus Codebase: `/packages/core/src/factory.ts`
- Columbus Codebase: `/packages/core/src/middleware/core.ts`
- Columbus Codebase: `/packages/core/src/server.ts`
- Columbus Codebase: `/examples/paidApi.ts`
- Columbus Codebase: `/examples/facilitator-server/src/app.ts`

---

## Recommendations

1. **For implementing new resources:** Use the `createElysiaPaidRoutes()` (or Hono/Express equivalent) with `payment` hook to define pricing per endpoint.

2. **For high-frequency micropayments:** Use the `upto` scheme with session tracking and sweeper for efficient batched settlement.

3. **For multi-chain support:** Configure multiple signer configs with CAIP-2 network identifiers.

4. **For production:** Use Redis-backed session store (`RedisUptoSessionStore`) and distributed sweeper lock (`createRedisSweeperLock`).

---

## Open Questions

1. **Discovery API** - The spec mentions `/discovery/resources` for listing x402-enabled resources, but implementation details in Columbus weren't found.

2. **Extensions Mechanism** - How to implement custom extensions for additional protocol functionality.

3. **Authentication Integration** - Details on integrating SIWE for user-verified pricing tiers.
