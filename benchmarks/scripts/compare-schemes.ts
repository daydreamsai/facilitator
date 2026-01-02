/**
 * Exact vs Upto Scheme Comparison Test
 * 
 * Tests 10 API calls with each scheme and compares latency
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createUnifiedClient } from "../src/unifiedClient.js";
import { readFileSync } from "fs";

// ============================================================================
// Configuration
// ============================================================================

const API_URL = "http://localhost:4050"; // Different port for this test
const FACILITATOR_URL = "http://localhost:8090";
const RPC_URL = process.env.EVM_RPC_URL_POLYGON || "https://polygon.gateway.tenderly.co/1bLJbEpGCgXFSNi3f5Q8Kb";
const NUM_CALLS = 10;

interface TestResult {
  scheme: string;
  walletAddress: string;
  calls: Array<{
    callNumber: number;
    latency: number;
    success: boolean;
    error?: string;
  }>;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  successRate: number;
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     🆚 Exact vs Upto Scheme Comparison Test                 ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log(`║  API URL:        ${API_URL.padEnd(44)} ║`);
  console.log(`║  Facilitator:    ${FACILITATOR_URL.padEnd(44)} ║`);
  console.log(`║  Calls per test: ${NUM_CALLS.toString().padEnd(44)} ║`);
  console.log(`║  Price:          $0.001 USDC${" ".repeat(35)} ║`);
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  // Load wallets
  const walletConfigPath = "benchmarks/wallets.json";
  let walletConfig: {
    wallets: Array<{
      address: string;
      privateKey: string;
    }>;
  };
  
  try {
    walletConfig = JSON.parse(readFileSync(walletConfigPath, "utf-8"));
  } catch (error) {
    console.error(`❌ Failed to load wallet config from ${walletConfigPath}`);
    process.exit(1);
  }

  if (walletConfig.wallets.length < 2) {
    console.error("❌ Need at least 2 wallets");
    process.exit(1);
  }

  // Wallet 1 for exact scheme
  const exactWallet = walletConfig.wallets[0];
  const exactAccount = privateKeyToAccount(
    (exactWallet.privateKey.startsWith('0x') ? exactWallet.privateKey : `0x${exactWallet.privateKey}`) as `0x${string}`
  );

  // Wallet 2 for upto scheme
  const uptoWallet = walletConfig.wallets[1];
  const uptoAccount = privateKeyToAccount(
    (uptoWallet.privateKey.startsWith('0x') ? uptoWallet.privateKey : `0x${uptoWallet.privateKey}`) as `0x${string}`
  );

  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  console.log("🔑 Test Wallets:");
  console.log(`   Exact Scheme: ${exactAccount.address}`);
  console.log(`   Upto Scheme:  ${uptoAccount.address}\n`);

  // ============================================================================
  // Test 1: Exact Scheme
  // ============================================================================

  console.log("═".repeat(70));
  console.log("📊 Test 1: EXACT SCHEME (Immediate Settlement)");
  console.log("═".repeat(70));

  const { fetchWithPayment: fetchExact } = createUnifiedClient({
    evmExact: { signer: exactAccount },
  });

  const exactResults: TestResult = {
    scheme: "exact",
    walletAddress: exactAccount.address,
    calls: [],
    avgLatency: 0,
    minLatency: 0,
    maxLatency: 0,
    successRate: 0,
  };

  for (let i = 1; i <= NUM_CALLS; i++) {
    console.log(`\n📞 Call ${i}/${NUM_CALLS}...`);
    const startTime = performance.now();
    
    try {
      const response = await fetchExact(`${API_URL}/api/benchmark-exact`);
      const endTime = performance.now();
      const latency = endTime - startTime;
      
      if (response.ok) {
        const data = await response.json();
        exactResults.calls.push({
          callNumber: i,
          latency,
          success: true,
        });
        console.log(`   ✅ Success - ${latency.toFixed(2)}ms`);
      } else {
        exactResults.calls.push({
          callNumber: i,
          latency,
          success: false,
          error: `HTTP ${response.status}`,
        });
        console.log(`   ❌ Failed - HTTP ${response.status}`);
      }
    } catch (error) {
      const endTime = performance.now();
      const latency = endTime - startTime;
      exactResults.calls.push({
        callNumber: i,
        latency,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error - ${error instanceof Error ? error.message : String(error)}`);
    }

    // Small delay between calls
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Calculate exact scheme stats
  const exactSuccessful = exactResults.calls.filter(c => c.success);
  const exactLatencies = exactSuccessful.map(c => c.latency);
  
  if (exactLatencies.length > 0) {
    exactResults.avgLatency = exactLatencies.reduce((a, b) => a + b, 0) / exactLatencies.length;
    exactResults.minLatency = Math.min(...exactLatencies);
    exactResults.maxLatency = Math.max(...exactLatencies);
  }
  exactResults.successRate = (exactSuccessful.length / NUM_CALLS) * 100;

  console.log("\n✅ Exact scheme test complete\n");

  // Wait between tests
  await new Promise(resolve => setTimeout(resolve, 3000));

  // ============================================================================
  // Test 2: Upto Scheme
  // ============================================================================

  console.log("═".repeat(70));
  console.log("📊 Test 2: UPTO SCHEME (Batched Settlement)");
  console.log("═".repeat(70));

  const { fetchWithPayment: fetchUpto } = createUnifiedClient({
    evmUpto: {
      signer: uptoAccount,
      publicClient,
      facilitatorUrl: FACILITATOR_URL,
    },
  });

  const uptoResults: TestResult = {
    scheme: "upto",
    walletAddress: uptoAccount.address,
    calls: [],
    avgLatency: 0,
    minLatency: 0,
    maxLatency: 0,
    successRate: 0,
  };

  for (let i = 1; i <= NUM_CALLS; i++) {
    console.log(`\n📞 Call ${i}/${NUM_CALLS}...`);
    const startTime = performance.now();
    
    try {
      const response = await fetchUpto(`${API_URL}/api/benchmark-upto`);
      const endTime = performance.now();
      const latency = endTime - startTime;
      
      if (response.ok) {
        const data = await response.json();
        uptoResults.calls.push({
          callNumber: i,
          latency,
          success: true,
        });
        console.log(`   ✅ Success - ${latency.toFixed(2)}ms`);
      } else {
        uptoResults.calls.push({
          callNumber: i,
          latency,
          success: false,
          error: `HTTP ${response.status}`,
        });
        console.log(`   ❌ Failed - HTTP ${response.status}`);
      }
    } catch (error) {
      const endTime = performance.now();
      const latency = endTime - startTime;
      uptoResults.calls.push({
        callNumber: i,
        latency,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`   ❌ Error - ${error instanceof Error ? error.message : String(error)}`);
    }

    // Small delay between calls
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Calculate upto scheme stats
  const uptoSuccessful = uptoResults.calls.filter(c => c.success);
  const uptoLatencies = uptoSuccessful.map(c => c.latency);
  
  if (uptoLatencies.length > 0) {
    uptoResults.avgLatency = uptoLatencies.reduce((a, b) => a + b, 0) / uptoLatencies.length;
    uptoResults.minLatency = Math.min(...uptoLatencies);
    uptoResults.maxLatency = Math.max(...uptoLatencies);
  }
  uptoResults.successRate = (uptoSuccessful.length / NUM_CALLS) * 100;

  console.log("\n✅ Upto scheme test complete\n");

  // ============================================================================
  // Results Comparison
  // ============================================================================

  console.log("\n" + "═".repeat(70));
  console.log("📊 RESULTS COMPARISON");
  console.log("═".repeat(70) + "\n");

  console.log("╔═══════════════╦═════════════════╦═════════════════╗");
  console.log("║    Metric     ║  Exact Scheme   ║  Upto Scheme    ║");
  console.log("╠═══════════════╬═════════════════╬═════════════════╣");
  console.log(`║ Success Rate  ║  ${exactResults.successRate.toFixed(1).padStart(6)}%       ║  ${uptoResults.successRate.toFixed(1).padStart(6)}%       ║`);
  console.log(`║ Avg Latency   ║  ${exactResults.avgLatency.toFixed(2).padStart(10)}ms ║  ${uptoResults.avgLatency.toFixed(2).padStart(10)}ms ║`);
  console.log(`║ Min Latency   ║  ${exactResults.minLatency.toFixed(2).padStart(10)}ms ║  ${uptoResults.minLatency.toFixed(2).padStart(10)}ms ║`);
  console.log(`║ Max Latency   ║  ${exactResults.maxLatency.toFixed(2).padStart(10)}ms ║  ${uptoResults.maxLatency.toFixed(2).padStart(10)}ms ║`);
  console.log("╚═══════════════╩═════════════════╩═════════════════╝\n");

  // Calculate improvement
  if (exactResults.avgLatency > 0 && uptoResults.avgLatency > 0) {
    const improvement = ((exactResults.avgLatency - uptoResults.avgLatency) / exactResults.avgLatency) * 100;
    if (improvement > 0) {
      console.log(`🚀 Upto scheme is ${improvement.toFixed(1)}% faster than exact scheme!`);
    } else {
      console.log(`⚠️  Exact scheme is ${Math.abs(improvement).toFixed(1)}% faster than upto scheme`);
    }
  }

  console.log("\n📋 Key Insights:");
  console.log("   • Exact Scheme: Each call triggers immediate on-chain settlement");
  console.log("   • Upto Scheme: Payments are verified but settlement is batched");
  console.log("   • Upto is faster because it doesn't wait for blockchain confirmation");
  console.log("   • Upto requires initial permit signature (done on first call)");

  console.log("\n🎉 Comparison test complete!");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

