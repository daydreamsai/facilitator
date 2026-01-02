/**
 * Comparison API Server
 * 
 * Provides both exact and upto scheme endpoints for comparison testing
 */

import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { HTTPFacilitatorClient } from "@x402/core/http";

import { createElysiaPaidRoutes } from "../src/elysia/index.js";
import { createResourceServer } from "../src/server.js";
import { createUptoModule } from "../src/upto/lib.js";
import { getRpcUrl } from "../src/config.js";
import { createPrivateKeyEvmSigner } from "../src/signers/index.js";

// ============================================================================
// Configuration
// ============================================================================

const PORT = 4050;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8090";

if (!process.env.EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY required");
  process.exit(1);
}

const rpcUrl = getRpcUrl("polygon");
if (!rpcUrl) {
  console.error("❌ Polygon RPC URL not configured");
  process.exit(1);
}

// ============================================================================
// Setup
// ============================================================================

const evmSigner = createPrivateKeyEvmSigner({
  network: "polygon",
  rpcUrl,
});

const [evmAddress] = evmSigner.getAddresses();

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = createResourceServer(facilitatorClient);
const upto = createUptoModule({ facilitatorClient, autoSweeper: true });

// ============================================================================
// API Server
// ============================================================================

export const app = new Elysia({
  prefix: "/api",
  name: "comparison-api",
  adapter: node(),
});

// Exact scheme endpoint
createElysiaPaidRoutes(app, {
  basePath: "/api",
  middleware: {
    resourceServer,
    autoSettle: true,
  },
}).get(
  "/benchmark-exact",
  () => ({
    scheme: "exact",
    message: "Exact scheme - immediate settlement",
    timestamp: Date.now(),
  }),
  {
    payment: {
      accepts: {
        scheme: "exact",
        network: "eip155:137",
        payTo: evmAddress,
        price: {
          amount: "1000", // 0.001 USDC (6 decimals)
          asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC on Polygon
          extra: {
            name: "USD Coin",
            version: "2",
          },
        },
      },
      description: "Exact scheme endpoint",
      mimeType: "application/json",
    },
  }
);

// Upto scheme endpoint
createElysiaPaidRoutes(app, {
  basePath: "/api",
  middleware: {
    resourceServer,
    upto,
    autoSettle: true,
  },
}).get(
  "/benchmark-upto",
  () => ({
    scheme: "upto",
    message: "Upto scheme - batched settlement",
    timestamp: Date.now(),
  }),
  {
    payment: {
      accepts: {
        scheme: "upto",
        network: "eip155:137",
        payTo: evmAddress,
        price: {
          amount: "1000", // 0.001 USDC (6 decimals)
          asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC on Polygon
          extra: {
            name: "USD Coin",
            version: "2",
          },
        },
      },
      description: "Upto scheme endpoint",
      mimeType: "application/json",
    },
  }
);

// Health check
app.get("/health", () => ({ status: "ok" }));

// Start server
app.listen(PORT);

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║        🆚 Comparison API Server - Exact vs Upto              ║
╠═══════════════════════════════════════════════════════════════╣
║  URL:         http://localhost:${PORT}                         ║
║  Facilitator:  ${FACILITATOR_URL.padEnd(48)} ║
║  Network:      Polygon (eip155:137)                           ║
║  Price:        $0.001 USDC per request                        ║
║  Pay To:       ${evmAddress.padEnd(42)} ║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET /api/benchmark-exact - Exact scheme                   ║
║    GET /api/benchmark-upto  - Upto scheme                    ║
║    GET /api/health          - Health check                   ║
╚═══════════════════════════════════════════════════════════════╝
`);

