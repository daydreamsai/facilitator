#!/usr/bin/env tsx
/**
 * x402 Benchmark - Exact vs Upto Scheme Comparison
 * 
 * Simple benchmark comparing payment schemes on Polygon
 * Run: bun run benchmarks/benchmark.ts
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createUnifiedClient } from "../src/unifiedClient.js";
import { readFileSync, existsSync } from "fs";

// Config
const API_URL = "http://localhost:4050";
const FACILITATOR_URL = "http://localhost:8090";
const RPC_URL = process.env.EVM_RPC_URL_POLYGON || "https://polygon.gateway.tenderly.co/1bLJbEpGCgXFSNi3f5Q8Kb";
const NUM_CALLS = 10;

interface TestResult {
  scheme: string;
  calls: number;
  successful: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
}

async function runTest(
  scheme: "exact" | "upto",
  wallet: { privateKey: string; address: string },
  endpoint: string
): Promise<TestResult> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Testing ${scheme.toUpperCase()} Scheme`);
  console.log("=".repeat(70));

  const account = privateKeyToAccount(
    (wallet.privateKey.startsWith('0x') ? wallet.privateKey : `0x${wallet.privateKey}`) as `0x${string}`
  );

  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  const clientConfig = scheme === "exact"
    ? { evmExact: { signer: account } }
    : { evmUpto: { signer: account, publicClient, facilitatorUrl: FACILITATOR_URL } };

  const { fetchWithPayment } = createUnifiedClient(clientConfig as any);

  const latencies: number[] = [];
  let successful = 0;

  for (let i = 1; i <= NUM_CALLS; i++) {
    process.stdout.write(`Call ${i}/${NUM_CALLS}... `);
    const start = performance.now();
    
    try {
      const response = await fetchWithPayment(`${API_URL}${endpoint}`);
      const latency = performance.now() - start;
      
      if (response.ok) {
        latencies.push(latency);
        successful++;
        console.log(`✅ ${latency.toFixed(2)}ms`);
      } else {
        console.log(`❌ HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ ${error instanceof Error ? error.message : 'Error'}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return {
    scheme,
    calls: NUM_CALLS,
    successful,
    avgLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b) / latencies.length : 0,
    minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
    maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
  };
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     🏁 x402 Benchmark - Exact vs Upto Comparison            ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  // Check for wallets
  if (!existsSync("benchmarks/wallets.json")) {
    console.error("❌ No wallets found!");
    console.error("\nSetup required:");
    console.error("1. Set MASTER_WALLET_PK with a wallet that has 0.1 USDC");
    console.error("2. Run: bun run benchmarks/setup/setup-wallets.ts\n");
    process.exit(1);
  }

  const wallets = JSON.parse(readFileSync("benchmarks/wallets.json", "utf-8")).wallets;
  
  // Test exact scheme (wallet 1)
  const exactResult = await runTest("exact", wallets[0], "/api/benchmark-exact");
  
  // Wait between tests
  await new Promise(r => setTimeout(r, 3000));
  
  // Test upto scheme (wallet 2)
  const uptoResult = await runTest("upto", wallets[1], "/api/benchmark-upto");

  // Results
  console.log("\n\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                    📊 RESULTS                                 ║");
  console.log("╠═══════════════╦═════════════════╦═════════════════════════════╣");
  console.log("║    Metric     ║  Exact Scheme   ║  Upto Scheme                ║");
  console.log("╠═══════════════╬═════════════════╬═════════════════════════════╣");
  console.log(`║ Success Rate  ║  ${((exactResult.successful/exactResult.calls)*100).toFixed(1).padStart(6)}%       ║  ${((uptoResult.successful/uptoResult.calls)*100).toFixed(1).padStart(6)}%                 ║`);
  console.log(`║ Avg Latency   ║  ${exactResult.avgLatency.toFixed(2).padStart(10)}ms ║  ${uptoResult.avgLatency.toFixed(2).padStart(10)}ms           ║`);
  console.log(`║ Min Latency   ║  ${exactResult.minLatency.toFixed(2).padStart(10)}ms ║  ${uptoResult.minLatency.toFixed(2).padStart(10)}ms           ║`);
  console.log(`║ Max Latency   ║  ${exactResult.maxLatency.toFixed(2).padStart(10)}ms ║  ${uptoResult.maxLatency.toFixed(2).padStart(10)}ms           ║`);
  console.log("╚═══════════════╩═════════════════╩═════════════════════════════╝\n");

  if (exactResult.avgLatency > 0 && uptoResult.avgLatency > 0) {
    const speedup = (exactResult.avgLatency / uptoResult.avgLatency).toFixed(0);
    console.log(`🚀 Upto is ${speedup}x faster than Exact!\n`);
  }

  console.log("✅ Benchmark complete!\n");
}

main().catch(console.error);

