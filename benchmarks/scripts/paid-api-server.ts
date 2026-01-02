/**
 * Benchmark Paid API Server
 * 
 * A test API with exact scheme pricing at $0.001 USDC per request.
 * Runs on port 4030 by default.
 */

import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { HTTPFacilitatorClient } from "@x402/core/http";

import { createElysiaPaidRoutes } from "../src/elysia/index.js";
import { createResourceServer } from "../src/server.js";
import { getRpcUrl } from "../src/config.js";
import { createPrivateKeyEvmSigner } from "../src/signers/index.js";

// ============================================================================
// Configuration
// ============================================================================

const PORT = Number(process.env.BENCHMARK_API_PORT ?? 4030);
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8090";

if (!process.env.EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY required for paid API");
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

// ============================================================================
// Metrics Tracking
// ============================================================================

interface Metrics {
  totalRequests: number;
  paidRequests: number;
  freeRequests: number;
  startTime: number;
  requestTimings: number[];
}

const metrics: Metrics = {
  totalRequests: 0,
  paidRequests: 0,
  freeRequests: 0,
  startTime: Date.now(),
  requestTimings: [],
};

// ============================================================================
// API Server
// ============================================================================

export const app = new Elysia({
  prefix: "/api",
  name: "benchmark-paid-api",
  adapter: node(),
});

// Metrics endpoint
app.get("/metrics", () => {
  const uptime = Date.now() - metrics.startTime;
  const avgTiming = metrics.requestTimings.length > 0
    ? metrics.requestTimings.reduce((a, b) => a + b, 0) / metrics.requestTimings.length
    : 0;

  return {
    uptime: `${Math.floor(uptime / 1000)}s`,
    totalRequests: metrics.totalRequests,
    paidRequests: metrics.paidRequests,
    freeRequests: metrics.freeRequests,
    avgResponseTime: `${avgTiming.toFixed(2)}ms`,
    requestsPerSecond: ((metrics.totalRequests / uptime) * 1000).toFixed(2),
  };
});

// Reset metrics endpoint
app.post("/metrics/reset", () => {
  metrics.totalRequests = 0;
  metrics.paidRequests = 0;
  metrics.freeRequests = 0;
  metrics.startTime = Date.now();
  metrics.requestTimings = [];
  return { message: "Metrics reset" };
});

// Paid endpoint
createElysiaPaidRoutes(app, {
  basePath: "/api",
  middleware: {
    resourceServer,
    autoSettle: true,
  },
}).get(
  "/benchmark",
  ({ request }) => {
    const startTime = performance.now();
    metrics.totalRequests++;
    metrics.paidRequests++;
    
    const responseTime = performance.now() - startTime;
    metrics.requestTimings.push(responseTime);
    
    // Keep only last 1000 timings
    if (metrics.requestTimings.length > 1000) {
      metrics.requestTimings.shift();
    }

    return {
      message: "Benchmark endpoint - paid request successful",
      timestamp: Date.now(),
      requestNumber: metrics.paidRequests,
      responseTime: `${responseTime.toFixed(2)}ms`,
    };
  },
  {
    payment: {
      accepts: {
        scheme: "exact",
        network: "eip155:137", // Polygon
        payTo: evmAddress,
        price: "$0.001", // 0.001 USDC per request
      },
      description: "Benchmark endpoint - $0.001 per request",
      mimeType: "application/json",
    },
  }
);

// Free health check endpoint
app.get("/health", () => {
  metrics.totalRequests++;
  metrics.freeRequests++;
  return { status: "ok", timestamp: Date.now() };
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT);

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         🏁 Benchmark Paid API Server - EXACT SCHEME          ║
╠═══════════════════════════════════════════════════════════════╣
║  URL:        http://localhost:${PORT}                         ║
║  Facilitator: ${FACILITATOR_URL.padEnd(49)} ║
║  Network:     Polygon (eip155:137)                            ║
║  Price:       $0.001 USDC per request                         ║
║  Pay To:      ${evmAddress.slice(0, 42).padEnd(42)} ║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET  /api/benchmark   - Paid endpoint ($0.001)            ║
║    GET  /api/health      - Free health check                 ║
║    GET  /api/metrics     - View metrics                      ║
║    POST /api/metrics/reset - Reset metrics                   ║
╚═══════════════════════════════════════════════════════════════╝
`);

