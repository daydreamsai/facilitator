# 🏁 Quick Start - Running x402 Benchmarks

Complete guide to benchmark your Polygon facilitator with multi-wallet load testing.

## Prerequisites

✅ Facilitator running on http://localhost:8090
✅ Master wallet with **0.2 USDC** on Polygon (for setup + tests)
✅ Master wallet with **MATIC** for gas fees

## Step-by-Step Guide

### 1️⃣ Setup Test Wallets (One-time)

Create 10 test wallets and fund each with 0.01 USDC:

```bash
cd /Users/agada/facilitator

# Set your master wallet private key (the one with USDC)
export MASTER_WALLET_PK=your_master_wallet_private_key_here

# Run wallet setup
bun run benchmark:setup
```

**Expected Output:**
```
🚀 Wallet Setup Script Starting...
📍 Master Wallet: 0x...
💰 Master USDC Balance: 1.5 USDC

🔑 Generating 10 wallets...
  Wallet 1: 0x...
  Wallet 2: 0x...
  ...

💸 Funding wallets with USDC...
  📤 Sending 0.01 USDC to wallet 1...
     ✅ Tx: 0x...
  ...

✅ Wallet configuration saved to: benchmarks/wallets.json
✅ Environment variables saved to: benchmarks/wallets.env

🎉 Wallet setup complete!
```

**Files Created:**
- `benchmarks/wallets.json` - Complete wallet data
- `benchmarks/wallets.env` - Environment variables

**Cost:** 0.1 USDC transferred + ~$0.01 gas

---

### 2️⃣ Start Benchmark API Server

In **Terminal 1** (keep running):

```bash
# Make sure facilitator is running first!
# If not: bun dev

# In Terminal 1:
cd /Users/agada/facilitator
bun run benchmark:api
```

**Expected Output:**
```
╔═══════════════════════════════════════════════════════════════╗
║         🏁 Benchmark Paid API Server - EXACT SCHEME          ║
╠═══════════════════════════════════════════════════════════════╣
║  URL:        http://localhost:4030                            ║
║  Facilitator: http://localhost:8090                           ║
║  Network:     Polygon (eip155:137)                            ║
║  Price:       $0.001 USDC per request                         ║
║  Pay To:      0xBBc4344Bb405858959d81aB1DEadD7a13EC37E13     ║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET  /api/benchmark   - Paid endpoint ($0.001)            ║
║    GET  /api/health      - Free health check                 ║
║    GET  /api/metrics     - View metrics                      ║
║    POST /api/metrics/reset - Reset metrics                   ║
╚═══════════════════════════════════════════════════════════════╝
```

**Test the API:**
```bash
# In another terminal:
curl http://localhost:4030/api/health
curl http://localhost:4030/api/metrics
```

---

### 3️⃣ Run Benchmarks

In **Terminal 2**:

```bash
cd /Users/agada/facilitator
bun run benchmark:run
```

**What Happens:**
1. Loads 10 wallets from `wallets.json`
2. Initializes payment clients
3. Runs 10 warmup requests
4. Tests at: **5, 10, 15, 20, 25, 30, 50 TPS**
5. Each test runs for **30 seconds**
6. Saves results to `benchmarks/results-[timestamp].json`

**Expected Output:**
```
╔═══════════════════════════════════════════════════════════════╗
║       🏁 x402 Payment Benchmark - Exact Scheme              ║
╠═══════════════════════════════════════════════════════════════╣
║  API URL:        http://localhost:4030                        ║
║  Facilitator:    http://localhost:8090                        ║
║  Duration:       30s per test                                 ║
║  TPS Rates:      5, 10, 15, 20, 25, 30, 50                   ║
╚═══════════════════════════════════════════════════════════════╝

✅ Loaded 10 wallets from benchmarks/wallets.json
🔧 Initializing benchmark clients...
✅ Initialized 10 clients

🔥 Running 10 warmup requests...
..........
✅ Warmup complete

======================================================================
🏁 Starting test: 5 TPS for 30s
======================================================================
📊 Progress: 100% | Requests: 150/150
✅ Test complete: 150 requests processed

╔═══════════════════════════════════════════════════════════════╗
║  📊 Test Results - 5 TPS                                      ║
╠═══════════════════════════════════════════════════════════════╣
║  Duration:           30s                                      ║
║  Total Requests:     150                                      ║
║  Successful:         148                                      ║
║  Failed:             2                                        ║
║  Error Rate:         1.33%                                    ║
╠═══════════════════════════════════════════════════════════════╣
║  Avg Latency:        2845.67ms                                ║
║  Min Latency:        1234.12ms                                ║
║  Max Latency:        8765.43ms                                ║
║  P50 Latency:        2543.00ms                                ║
║  P95 Latency:        6234.00ms                                ║
║  P99 Latency:        7890.00ms                                ║
╠═══════════════════════════════════════════════════════════════╣
║  Actual TPS:         5.00                                     ║
╚═══════════════════════════════════════════════════════════════╝

... (continues for all TPS rates)

╔═══════════════════════════════════════════════════════════════╗
║                    📊 Benchmark Summary                       ║
╠═════════╦══════════╦════════════╦════════════╦═══════════════╣
║   TPS   ║ Requests ║ Avg Latency║ P99 Latency║  Error Rate   ║
╠═════════╬══════════╬════════════╬════════════╬═══════════════╣
║      5 ║    150 ║  2845.67ms║  7890.00ms║     1.33%   ║
║     10 ║    300 ║  3123.45ms║  8234.56ms║     2.00%   ║
║     15 ║    450 ║  3456.78ms║  9123.45ms║     3.11%   ║
║     20 ║    600 ║  4123.45ms║ 10234.56ms║     5.00%   ║
║     25 ║    750 ║  5234.56ms║ 12345.67ms║     8.13%   ║
║     30 ║    900 ║  6345.67ms║ 14567.89ms║    12.22%   ║
║     50 ║   1500 ║  8456.78ms║ 18765.43ms║    23.40%   ║
╚═════════╩══════════╩════════════╩════════════╩═══════════════╝

✅ Results saved to: benchmarks/results-2025-01-01T12-30-45-123Z.json
🎉 Benchmark complete!
```

---

## 📊 Understanding Results

### Latency Components

For **Exact Scheme**, each request involves:

1. **Payment Creation** (~10-50ms)
   - Generate signature
   - Create payment header

2. **API Request** (~50-200ms)
   - HTTP to paid API
   - Payment verification

3. **Settlement** (~2-8 seconds) ⚠️ **Most time here!**
   - Submit transaction to Polygon
   - Wait for block confirmation
   - Return tx hash

**Total:** Usually 2-8 seconds per request

### Performance Metrics

| Metric | Good | Warning | Poor |
|--------|------|---------|------|
| Error Rate | <5% | 5-15% | >15% |
| Avg Latency | <4s | 4-8s | >8s |
| P99 Latency | <10s | 10-15s | >15s |

### What Affects Performance?

**✅ Good Performance:**
- Low network load
- Fast RPC provider
- Good Polygon block times
- Sufficient wallet balances

**❌ Poor Performance:**
- Network congestion
- RPC rate limiting
- High gas prices
- Empty wallets

---

## 🔍 View Results

### JSON Results File

```bash
# View full results
cat benchmarks/results-2025-01-01T12-30-45-123Z.json | jq .

# Extract specific TPS test
cat benchmarks/results-*.json | jq '.results[] | select(.tps == 20)'

# Get latency summary
cat benchmarks/results-*.json | jq '.results[] | {tps, avgLatency, p99Latency}'
```

### Server Metrics

```bash
# View API server metrics
curl http://localhost:4030/api/metrics | jq .

# Example output:
{
  "uptime": "180s",
  "totalRequests": 4050,
  "paidRequests": 4040,
  "freeRequests": 10,
  "avgResponseTime": "3456.78ms",
  "requestsPerSecond": "22.50"
}
```

---

## 💰 Cost Breakdown

### Setup (One-time)
- **USDC Distribution**: 0.1 USDC
- **Gas Fees**: ~$0.01
- **Total**: ~**$0.11**

### Per Benchmark Run
- **Total Requests**: 4,050
- **USDC Cost**: 4.05 USDC (4,050 × $0.001)
- **Gas Fees**: ~$0.10 (Polygon is cheap!)
- **Total**: ~**$4.15**

### Per TPS Test (30s)
| TPS | Requests | USDC Cost | Gas Cost | Total |
|-----|----------|-----------|----------|-------|
| 5   | 150      | $0.15     | ~$0.01   | ~$0.16 |
| 10  | 300      | $0.30     | ~$0.02   | ~$0.32 |
| 20  | 600      | $0.60     | ~$0.03   | ~$0.63 |
| 50  | 1500     | $1.50     | ~$0.08   | ~$1.58 |

---

## 🛠️ Troubleshooting

### "Insufficient USDC balance"
**Problem:** Master wallet doesn't have enough USDC

**Solution:**
```bash
# Check balance on Polygon
# Add more USDC to master wallet
```

### "RPC rate limiting"
**Problem:** Too many RPC requests

**Solution:**
- Use dedicated RPC (Alchemy, Infura)
- Set in `.env`:
```bash
EVM_RPC_URL_POLYGON=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### "Facilitator not responding"
**Problem:** Facilitator is down

**Solution:**
```bash
# Check if running
curl http://localhost:8090/supported

# Restart if needed
cd /Users/agada/facilitator
bun dev
```

### "High error rates"
**Problem:** Network congestion or issues

**Solutions:**
1. **Lower TPS**: Test at lower rates
2. **Increase timeout**: Modify benchmark config
3. **Check RPC**: Use better provider
4. **Wait**: Try during off-peak hours

### "Wallets running out of USDC"
**Problem:** Test wallets exhausted

**Solution:**
```bash
# Re-run setup to refund wallets
export MASTER_WALLET_PK=your_key
bun run benchmark:setup
```

---

## 🎯 Next Steps

### 1. Analyze Results
- Identify latency patterns
- Find bottlenecks
- Compare TPS performance

### 2. Optimize
- Improve RPC provider
- Adjust test parameters
- Scale infrastructure

### 3. Compare Schemes
- Run same tests with **Upto scheme**
- Compare gas efficiency
- Analyze latency differences

### 4. Production Planning
- Determine optimal TPS
- Plan capacity
- Set monitoring thresholds

---

## 📚 Additional Resources

- **Benchmark README**: `benchmarks/README.md`
- **Main Setup**: `SETUP_SUMMARY.md`
- **Polygon Setup**: `POLYGON_SETUP.md`

---

**Questions? Issues?**

Check the facilitator logs:
```bash
# View facilitator terminal
# Or check recent activity
curl http://localhost:8090/supported
```

**Happy Benchmarking! 🚀**

