# x402 Benchmark - Exact vs Upto Comparison

Simple benchmark comparing payment scheme latency and gas costs on Polygon.

## Quick Start

```bash
# 1. Start the facilitator (in terminal 1)
cd facilitator
bun dev

# 2. Start the API server (in terminal 2)
bun run benchmarks/comparison-api-server.ts

# 3. Run the benchmark (in terminal 3)
bun run benchmarks/benchmark.ts
```

That's it! The benchmark will run 10 API calls with each scheme and show you the results.

## What It Tests

- **Exact Scheme**: Immediate on-chain settlement per payment (~6-8s latency)
- **Upto Scheme**: Off-chain permit signatures + batched settlement (<100ms latency)
- **Price**: $0.001 USDC per API call
- **Network**: Polygon (CAIP-2: `eip155:137`)

## Results

From the latest benchmark run:

```
╔═══════════════╦═════════════════╦═════════════════════════════╗
║    Metric     ║  Exact Scheme   ║  Upto Scheme                ║
╠═══════════════╬═════════════════╬═════════════════════════════╣
║ Success Rate  ║    90.0%        ║   100.0%                    ║
║ Avg Latency   ║    3693.54ms    ║    5.50ms                   ║
║ Min Latency   ║    3456.91ms    ║    2.11ms                   ║
║ Max Latency   ║    4137.17ms    ║    14.46ms                  ║
╠═══════════════╬═════════════════╬═════════════════════════════╣
╚═══════════════╩═════════════════╩═════════════════════════════╝

**Key Takeaway:** For micro-payments, Upto scheme is dramatically faster and cheaper.

---

## Setup (First Time Only)

The benchmark needs funded wallets. If you see "No wallets found", set up once:

### 1. Get a Master Wallet

You need a wallet with:
- **0.1 USDC** (to fund test wallets)
- **0.1 MATIC** (for gas fees)

### 2. Set Environment Variable

```bash
# Add to your ~/.zshrc or run before setup:
export MASTER_WALLET_PK="your_private_key_without_0x_prefix"
```

### 3. Create Test Wallets

```bash
bun run benchmarks/setup/setup-wallets.ts
```

This creates 10 wallets with 0.01 USDC each, saving them to `wallets.json`.

### 4. Check Balances (Optional)

```bash
bun run benchmarks/setup/check-balances.ts
```

---

## Project Structure

```
benchmarks/
├── benchmark.ts                 # 👈 Main benchmark (run this!)
├── comparison-api-server.ts     # Test API server
├── wallets.json                 # Generated test wallets
├── setup/                       # One-time setup scripts
│   ├── setup-wallets.ts
│   └── check-balances.ts
├── scripts/                     # Advanced tests
│   ├── run-benchmark.ts         # TPS load testing
│   ├── paid-api-server.ts       # TPS test server
│   └── test-exact-single.ts     # Debug single calls
└── docs/                        # Documentation
    ├── QUICKSTART.md
    └── COMPARISON_RESULTS.md
```

---

## Understanding the Results

### Latency
- **Exact**: Every payment waits for blockchain confirmation (~6-8 seconds)
- **Upto**: Off-chain signature, instant response (~100-300ms)

### Gas Costs
- **Exact**: Separate on-chain transaction per payment (~$0.006 per call)
- **Upto**: One batched transaction for all payments (~$0.0016 total)

### When to Use What
- **Exact**: High-value payments needing immediate on-chain finality
- **Upto**: Micro-payments, high-frequency APIs, cost-sensitive apps

---

## Troubleshooting

**"No wallets found"**: Run `bun run benchmarks/setup/setup-wallets.ts` first

**"Connection refused"**: Make sure facilitator is running (`bun dev`)

**"Insufficient funds"**: Check your master wallet has 0.1 USDC and 0.1 MATIC

**"Invalid private key"**: Don't include `0x` prefix when setting `MASTER_WALLET_PK`

---

## Advanced Testing

See `/benchmarks/scripts/` for:
- **TPS load testing**: Test different transaction rates
- **Single call debugging**: Debug individual payment flows

See `/benchmarks/docs/` for:
- **Detailed setup guide**: `QUICKSTART.md`
- **Full results analysis**: `COMPARISON_RESULTS.md`
