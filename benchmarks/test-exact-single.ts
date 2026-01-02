/**
 * Single Exact Scheme Test
 */

import { privateKeyToAccount } from "viem/accounts";
import { createUnifiedClient } from "../src/unifiedClient.js";
import { readFileSync } from "fs";

const API_URL = "http://localhost:4050";

async function main() {
  console.log("🧪 Testing Exact Scheme (Single Call)\n");

  // Load first wallet
  const walletConfig = JSON.parse(readFileSync("benchmarks/wallets.json", "utf-8"));
  const wallet = walletConfig.wallets[0];
  
  const account = privateKeyToAccount(
    (wallet.privateKey.startsWith('0x') ? wallet.privateKey : `0x${wallet.privateKey}`) as `0x${string}`
  );

  console.log(`🔑 Wallet: ${account.address}\n`);

  const { fetchWithPayment } = createUnifiedClient({
    evmExact: { signer: account },
  });

  console.log("📞 Making payment request...");
  const startTime = performance.now();
  
  try {
    const response = await fetchWithPayment(`${API_URL}/api/benchmark-exact`);
    const endTime = performance.now();
    const latency = endTime - startTime;
    
    if (response.ok) {
      const data = await response.json();
      console.log(`\n✅ SUCCESS!`);
      console.log(`   Latency: ${latency.toFixed(2)}ms`);
      console.log(`   Response:`, data);
      
      // Check for settlement header
      const settlementHeader = response.headers.get('x-payment-response');
      if (settlementHeader) {
        console.log(`   Settlement: ${settlementHeader}`);
      }
    } else {
      console.log(`\n❌ FAILED`);
      console.log(`   HTTP Status: ${response.status}`);
      console.log(`   Latency: ${latency.toFixed(2)}ms`);
      const text = await response.text();
      console.log(`   Error: ${text}`);
    }
  } catch (error) {
    const endTime = performance.now();
    const latency = endTime - startTime;
    console.log(`\n❌ ERROR`);
    console.log(`   Latency: ${latency.toFixed(2)}ms`);
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main();

