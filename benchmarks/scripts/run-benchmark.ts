/**
 * Benchmark Client - Latency Testing
 * 
 * Tests x402 payment latency under various load conditions.
 * Supports multi-wallet testing with configurable TPS rates.
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createUnifiedClient } from "../src/unifiedClient.js";
import { readFileSync, writeFileSync } from "fs";

// ============================================================================
// Configuration
// ============================================================================

interface BenchmarkConfig {
  apiUrl: string;
  facilitatorUrl: string;
  rpcUrl: string;
  tpsRates: number[]; // Transactions per second to test
  durationSeconds: number; // Duration for each test
  warmupRequests: number; // Warmup requests before test
}

interface WalletConfig {
  wallets: Array<{
    address: string;
    privateKey: string;
  }>;
}

interface RequestMetrics {
  walletIndex: number;
  walletAddress: string;
  requestNumber: number;
  startTime: number;
  endTime: number;
  latency: number;
  success: boolean;
  error?: string;
  statusCode?: number;
  txHash?: string;
}

interface TestResult {
  tps: number;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  requestsPerSecond: number;
  errorRate: number;
  metrics: RequestMetrics[];
}

// ============================================================================
// Utility Functions
// ============================================================================

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Benchmark Runner
// ============================================================================

class BenchmarkRunner {
  private config: BenchmarkConfig;
  private walletConfig: WalletConfig;
  private clients: Array<{ fetchWithPayment: (url: string) => Promise<Response> }> = [];

  constructor(config: BenchmarkConfig, walletConfig: WalletConfig) {
    this.config = config;
    this.walletConfig = walletConfig;
  }

  async initialize() {
    console.log("🔧 Initializing benchmark clients...");

    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(this.config.rpcUrl),
    });

    for (const wallet of this.walletConfig.wallets) {
      const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
      
      const { fetchWithPayment } = createUnifiedClient({
        evmExact: { signer: account },
        fetch: globalThis.fetch,
      });

      this.clients.push({ fetchWithPayment });
    }

    console.log(`✅ Initialized ${this.clients.length} clients\n`);
  }

  async warmup() {
    console.log(`🔥 Running ${this.config.warmupRequests} warmup requests...`);
    
    for (let i = 0; i < this.config.warmupRequests; i++) {
      const clientIndex = i % this.clients.length;
      try {
        await this.clients[clientIndex].fetchWithPayment(
          `${this.config.apiUrl}/api/benchmark`
        );
        process.stdout.write(".");
      } catch (error) {
        process.stdout.write("x");
      }
    }
    
    console.log("\n✅ Warmup complete\n");
    await sleep(2000);
  }

  async runTest(tps: number): Promise<TestResult> {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🏁 Starting test: ${tps} TPS for ${this.config.durationSeconds}s`);
    console.log("=".repeat(70));

    const metrics: RequestMetrics[] = [];
    const targetRequests = tps * this.config.durationSeconds;
    const intervalMs = 1000 / tps; // Time between requests
    
    let requestNumber = 0;
    const startTime = Date.now();
    const endTime = startTime + (this.config.durationSeconds * 1000);

    // Create request scheduler
    const makeRequest = async (walletIndex: number) => {
      requestNumber++;
      const reqNum = requestNumber;
      const reqStartTime = performance.now();
      
      try {
        const response = await this.clients[walletIndex].fetchWithPayment(
          `${this.config.apiUrl}/api/benchmark`
        );
        
        const reqEndTime = performance.now();
        const latency = reqEndTime - reqStartTime;

        const data = await response.json().catch(() => ({}));
        const txHash = response.headers.get("x-payment-response");

        metrics.push({
          walletIndex,
          walletAddress: this.walletConfig.wallets[walletIndex].address,
          requestNumber: reqNum,
          startTime: reqStartTime,
          endTime: reqEndTime,
          latency,
          success: response.ok,
          statusCode: response.status,
          txHash: txHash || undefined,
        });

        return true;
      } catch (error) {
        const reqEndTime = performance.now();
        const latency = reqEndTime - reqStartTime;

        metrics.push({
          walletIndex,
          walletAddress: this.walletConfig.wallets[walletIndex].address,
          requestNumber: reqNum,
          startTime: reqStartTime,
          endTime: reqEndTime,
          latency,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        return false;
      }
    };

    // Run requests at specified TPS
    const promises: Promise<boolean>[] = [];
    let walletIndex = 0;
    
    while (Date.now() < endTime && requestNumber < targetRequests) {
      const reqStartTime = Date.now();
      
      // Send request
      promises.push(makeRequest(walletIndex));
      
      // Round-robin across wallets
      walletIndex = (walletIndex + 1) % this.clients.length;
      
      // Calculate delay to maintain TPS
      const elapsed = Date.now() - reqStartTime;
      const delay = Math.max(0, intervalMs - elapsed);
      
      if (delay > 0) {
        await sleep(delay);
      }

      // Progress indicator
      if (requestNumber % 10 === 0) {
        const progress = ((Date.now() - startTime) / (endTime - startTime) * 100).toFixed(0);
        process.stdout.write(`\r📊 Progress: ${progress}% | Requests: ${requestNumber}/${targetRequests}`);
      }
    }

    // Wait for all requests to complete
    await Promise.all(promises);
    
    console.log(`\n✅ Test complete: ${metrics.length} requests processed\n`);

    // Calculate statistics
    const successfulMetrics = metrics.filter(m => m.success);
    const latencies = successfulMetrics.map(m => m.latency);
    
    const result: TestResult = {
      tps,
      duration: this.config.durationSeconds,
      totalRequests: metrics.length,
      successfulRequests: successfulMetrics.length,
      failedRequests: metrics.length - successfulMetrics.length,
      avgLatency: latencies.length > 0 
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
        : 0,
      minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
      p50Latency: calculatePercentile(latencies, 50),
      p95Latency: calculatePercentile(latencies, 95),
      p99Latency: calculatePercentile(latencies, 99),
      requestsPerSecond: metrics.length / this.config.durationSeconds,
      errorRate: ((metrics.length - successfulMetrics.length) / metrics.length) * 100,
      metrics,
    };

    return result;
  }

  printResults(result: TestResult) {
    console.log("\n╔═══════════════════════════════════════════════════════════════╗");
    console.log(`║  📊 Test Results - ${result.tps} TPS                                    ║`);
    console.log("╠═══════════════════════════════════════════════════════════════╣");
    console.log(`║  Duration:           ${result.duration}s${" ".repeat(40)} ║`);
    console.log(`║  Total Requests:     ${result.totalRequests.toString().padEnd(40)} ║`);
    console.log(`║  Successful:         ${result.successfulRequests.toString().padEnd(40)} ║`);
    console.log(`║  Failed:             ${result.failedRequests.toString().padEnd(40)} ║`);
    console.log(`║  Error Rate:         ${result.errorRate.toFixed(2)}%${" ".repeat(37)} ║`);
    console.log("╠═══════════════════════════════════════════════════════════════╣");
    console.log(`║  Avg Latency:        ${result.avgLatency.toFixed(2)}ms${" ".repeat(36)} ║`);
    console.log(`║  Min Latency:        ${result.minLatency.toFixed(2)}ms${" ".repeat(36)} ║`);
    console.log(`║  Max Latency:        ${result.maxLatency.toFixed(2)}ms${" ".repeat(36)} ║`);
    console.log(`║  P50 Latency:        ${result.p50Latency.toFixed(2)}ms${" ".repeat(36)} ║`);
    console.log(`║  P95 Latency:        ${result.p95Latency.toFixed(2)}ms${" ".repeat(36)} ║`);
    console.log(`║  P99 Latency:        ${result.p99Latency.toFixed(2)}ms${" ".repeat(36)} ║`);
    console.log("╠═══════════════════════════════════════════════════════════════╣");
    console.log(`║  Actual TPS:         ${result.requestsPerSecond.toFixed(2)}${" ".repeat(37)} ║`);
    console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config: BenchmarkConfig = {
    apiUrl: process.env.BENCHMARK_API_URL || "http://localhost:4030",
    facilitatorUrl: process.env.FACILITATOR_URL || "http://localhost:8090",
    rpcUrl: process.env.EVM_RPC_URL_POLYGON || "https://polygon.gateway.tenderly.co/1bLJbEpGCgXFSNi3f5Q8Kb",
    tpsRates: [5, 10, 15, 20, 25, 30, 50],
    durationSeconds: 30,
    warmupRequests: 10,
  };

  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║       🏁 x402 Payment Benchmark - Exact Scheme              ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log(`║  API URL:        ${config.apiUrl.padEnd(44)} ║`);
  console.log(`║  Facilitator:    ${config.facilitatorUrl.padEnd(44)} ║`);
  console.log(`║  Duration:       ${config.durationSeconds}s per test${" ".repeat(35)} ║`);
  console.log(`║  TPS Rates:      ${config.tpsRates.join(", ").padEnd(44)} ║`);
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  // Load wallet configuration
  const walletConfigPath = "benchmarks/wallets.json";
  let walletConfig: WalletConfig;
  
  try {
    walletConfig = JSON.parse(readFileSync(walletConfigPath, "utf-8"));
    console.log(`✅ Loaded ${walletConfig.wallets.length} wallets from ${walletConfigPath}\n`);
  } catch (error) {
    console.error(`❌ Failed to load wallet config from ${walletConfigPath}`);
    console.error("   Run 'bun run benchmarks/setup-wallets.ts' first");
    process.exit(1);
  }

  // Initialize benchmark runner
  const runner = new BenchmarkRunner(config, walletConfig);
  await runner.initialize();
  await runner.warmup();

  // Run tests
  const results: TestResult[] = [];
  
  for (const tps of config.tpsRates) {
    const result = await runner.runTest(tps);
    runner.printResults(result);
    results.push(result);
    
    // Wait between tests
    await sleep(5000);
  }

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsPath = `benchmarks/results-${timestamp}.json`;
  
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config,
    results,
  }, null, 2));

  console.log(`\n✅ Results saved to: ${resultsPath}`);

  // Print summary
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                    📊 Benchmark Summary                       ║");
  console.log("╠═════════╦══════════╦════════════╦════════════╦═══════════════╣");
  console.log("║   TPS   ║ Requests ║ Avg Latency║ P99 Latency║  Error Rate   ║");
  console.log("╠═════════╬══════════╬════════════╬════════════╬═══════════════╣");
  
  results.forEach(r => {
    console.log(`║  ${r.tps.toString().padStart(5)} ║  ${r.totalRequests.toString().padStart(6)} ║  ${r.avgLatency.toFixed(2).padStart(8)}ms║  ${r.p99Latency.toFixed(2).padStart(8)}ms║    ${r.errorRate.toFixed(2).padStart(6)}%   ║`);
  });
  
  console.log("╚═════════╩══════════╩════════════╩════════════╩═══════════════╝");

  console.log("\n🎉 Benchmark complete!");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

