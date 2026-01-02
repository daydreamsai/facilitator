/**
 * Wallet Setup Script
 * 
 * Creates 10 new wallets and funds each with 0.01 USDC from the master wallet.
 * Total: 0.1 USDC will be distributed.
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { polygon } from "viem/chains";
import { writeFileSync } from "fs";

// ============================================================================
// Configuration
// ============================================================================

const MASTER_PRIVATE_KEY = process.env.MASTER_WALLET_PK;
const RPC_URL = process.env.EVM_RPC_URL_POLYGON || "https://polygon.gateway.tenderly.co/1bLJbEpGCgXFSNi3f5Q8Kb";

// USDC on Polygon
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;
const USDC_DECIMALS = 6;

const AMOUNT_PER_WALLET = "0.01"; // 0.01 USDC per wallet
const NUM_WALLETS = 10;

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
  {
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  if (!MASTER_PRIVATE_KEY) {
    console.error("❌ MASTER_WALLET_PK environment variable is required");
    process.exit(1);
  }

  console.log("🚀 Wallet Setup Script Starting...\n");

  // Setup clients
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  // Ensure private key has 0x prefix
  const formattedKey = MASTER_PRIVATE_KEY.startsWith('0x') 
    ? MASTER_PRIVATE_KEY 
    : `0x${MASTER_PRIVATE_KEY}`;
  
  const masterAccount = privateKeyToAccount(formattedKey as `0x${string}`);
  
  const walletClient = createWalletClient({
    account: masterAccount,
    chain: polygon,
    transport: http(RPC_URL),
  });

  console.log(`📍 Master Wallet: ${masterAccount.address}`);
  console.log(`📍 USDC Contract: ${USDC_ADDRESS}`);
  console.log(`📍 RPC: ${RPC_URL}\n`);

  // Check master wallet balance
  const masterBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [masterAccount.address],
  });

  const masterBalanceFormatted = formatUnits(masterBalance, USDC_DECIMALS);
  console.log(`💰 Master USDC Balance: ${masterBalanceFormatted} USDC\n`);

  const totalNeeded = parseFloat(AMOUNT_PER_WALLET) * NUM_WALLETS;
  if (parseFloat(masterBalanceFormatted) < totalNeeded) {
    console.error(`❌ Insufficient USDC balance. Need ${totalNeeded} USDC, have ${masterBalanceFormatted} USDC`);
    process.exit(1);
  }

  // Generate wallets
  console.log(`🔑 Generating ${NUM_WALLETS} wallets...\n`);
  
  const wallets: Array<{
    address: string;
    privateKey: string;
  }> = [];

  for (let i = 0; i < NUM_WALLETS; i++) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    wallets.push({
      address: account.address,
      privateKey,
    });

    console.log(`  Wallet ${i + 1}: ${account.address}`);
  }

  console.log("\n💸 Funding wallets with USDC...\n");

  const amountToSend = parseUnits(AMOUNT_PER_WALLET, USDC_DECIMALS);
  const results: Array<{
    wallet: number;
    address: string;
    txHash: string;
    amount: string;
  }> = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    
    try {
      console.log(`  📤 Sending ${AMOUNT_PER_WALLET} USDC to wallet ${i + 1}...`);
      
      const hash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [wallet.address as `0x${string}`, amountToSend],
      });

      console.log(`     ✅ Tx: ${hash}`);
      
      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });
      
      results.push({
        wallet: i + 1,
        address: wallet.address,
        txHash: hash,
        amount: AMOUNT_PER_WALLET,
      });

      // Small delay between transactions
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`     ❌ Failed to fund wallet ${i + 1}:`, error);
    }
  }

  // Verify balances
  console.log("\n🔍 Verifying wallet balances...\n");

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    
    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet.address as `0x${string}`],
    });

    const balanceFormatted = formatUnits(balance, USDC_DECIMALS);
    console.log(`  Wallet ${i + 1}: ${balanceFormatted} USDC`);
  }

  // Save wallet configuration
  const config = {
    createdAt: new Date().toISOString(),
    masterWallet: masterAccount.address,
    network: "polygon",
    usdcAddress: USDC_ADDRESS,
    rpcUrl: RPC_URL,
    wallets: wallets,
    funding: results,
  };

  const configPath = "benchmarks/wallets.json";
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  console.log(`\n✅ Wallet configuration saved to: ${configPath}`);
  
  // Create .env snippet
  const envSnippet = wallets
    .map((w, i) => `BENCHMARK_WALLET_${i + 1}_PK=${w.privateKey}`)
    .join("\n");
  
  const envPath = "benchmarks/wallets.env";
  writeFileSync(envPath, envSnippet);
  
  console.log(`✅ Environment variables saved to: ${envPath}`);

  // Summary
  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║           📊 Setup Summary                    ║");
  console.log("╠═══════════════════════════════════════════════╣");
  console.log(`║  Wallets Created:  ${NUM_WALLETS.toString().padEnd(27)} ║`);
  console.log(`║  Amount Per Wallet: ${AMOUNT_PER_WALLET} USDC${" ".repeat(19)} ║`);
  console.log(`║  Total Distributed: ${(parseFloat(AMOUNT_PER_WALLET) * NUM_WALLETS).toFixed(2)} USDC${" ".repeat(19)} ║`);
  console.log(`║  Successful Funds:  ${results.length.toString().padEnd(27)} ║`);
  console.log("╚═══════════════════════════════════════════════╝");
  
  console.log("\n🎉 Wallet setup complete!");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

