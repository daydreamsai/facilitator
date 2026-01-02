/**
 * Check Wallet Balances
 * 
 * Checks USDC and MATIC balances for all benchmark wallets
 */

import { createPublicClient, http, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { readFileSync } from "fs";

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = process.env.EVM_RPC_URL_POLYGON || "https://polygon.gateway.tenderly.co/1bLJbEpGCgXFSNi3f5Q8Kb";

// USDC on Polygon
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;
const USDC_DECIMALS = 6;

// ============================================================================
// USDC ABI (ERC-20)
// ============================================================================

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  console.log("🔍 Checking Wallet Balances...\n");

  // Load wallet configuration
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
    console.error("   Run 'bun run benchmark:setup' first");
    process.exit(1);
  }

  // Setup client
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  console.log(`📍 Network: Polygon`);
  console.log(`📍 USDC Contract: ${USDC_ADDRESS}`);
  console.log(`📍 RPC: ${RPC_URL}\n`);

  console.log("╔═══════════╦══════════════════════════════════════════════╦═════════════╦═════════════╗");
  console.log("║  Wallet   ║                   Address                    ║  USDC       ║  MATIC      ║");
  console.log("╠═══════════╬══════════════════════════════════════════════╬═════════════╬═════════════╣");

  let totalUsdc = 0n;
  let totalMatic = 0n;
  let emptyWallets = 0;

  for (let i = 0; i < walletConfig.wallets.length; i++) {
    const wallet = walletConfig.wallets[i];
    
    try {
      // Get USDC balance
      const usdcBalance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address as `0x${string}`],
      });

      // Get MATIC balance
      const maticBalance = await publicClient.getBalance({
        address: wallet.address as `0x${string}`,
      });

      const usdcFormatted = formatUnits(usdcBalance, USDC_DECIMALS);
      const maticFormatted = formatUnits(maticBalance, 18);

      totalUsdc += usdcBalance;
      totalMatic += maticBalance;

      if (usdcBalance === 0n && maticBalance === 0n) {
        emptyWallets++;
      }

      const status = usdcBalance > 0n ? "✅" : "❌";
      const gasStatus = maticBalance > 0n ? "✅" : "⚠️ ";

      console.log(`║  ${status} ${(i + 1).toString().padStart(2)}     ║ ${wallet.address} ║  ${usdcFormatted.padStart(10)} ║  ${gasStatus} ${maticFormatted.padStart(7)} ║`);
    } catch (error) {
      console.log(`║  ❌ ${(i + 1).toString().padStart(2)}     ║ ${wallet.address} ║     ERROR   ║     ERROR   ║`);
    }
  }

  console.log("╠═══════════╩══════════════════════════════════════════════╬═════════════╬═════════════╣");
  const totalUsdcFormatted = formatUnits(totalUsdc, USDC_DECIMALS);
  const totalMaticFormatted = formatUnits(totalMatic, 18);
  console.log(`║  TOTAL (${walletConfig.wallets.length} wallets)                                       ║  ${totalUsdcFormatted.padStart(10)} ║  ${totalMaticFormatted.padStart(10)} ║`);
  console.log("╚══════════════════════════════════════════════════════════╩═════════════╩═════════════╝");

  console.log("\n📊 Summary:");
  console.log(`   • Total Wallets: ${walletConfig.wallets.length}`);
  console.log(`   • Empty Wallets: ${emptyWallets}`);
  console.log(`   • Funded Wallets: ${walletConfig.wallets.length - emptyWallets}`);
  console.log(`   • Total USDC: ${totalUsdcFormatted}`);
  console.log(`   • Total MATIC: ${totalMaticFormatted}`);

  if (emptyWallets > 0) {
    console.log("\n⚠️  Warning: Some wallets are empty and won't be able to make payments");
  }

  if (totalMatic === 0n) {
    console.log("\n⚠️  Warning: No MATIC for gas fees! Transactions will fail.");
    console.log("   Solution: Send some MATIC to these wallets for gas");
  }

  if (totalUsdc === 0n) {
    console.log("\n❌ Error: No USDC in any wallet! Cannot make payments.");
    console.log("   Solution: Run 'bun run benchmark:setup' to fund wallets");
  }
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

