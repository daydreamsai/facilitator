# x402 Payment Benchmarking Suite

Comprehensive benchmarking tools for testing x402 payment system latency and throughput on Polygon network.

## Overview

This benchmark suite tests the **Exact Scheme** payment flow with:
- **Price**: $0.001 USDC per request
- **Network**: Polygon mainnet
- **Multi-wallet**: 10 wallets for distributed load
- **TPS Testing**: 5, 10, 15, 20, 25, 30, 50 transactions per second

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Wallets   │────▶│  Paid API    │────▶│ Facilitator │
│  (10 total) │     │  (port 4030) │     │ (port 8090) │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                                                 ▼
                                          ┌─────────────┐
                                          │  Polygon    │
                                          │  Network    │
                                          └─────────────┘
```

## Files

- `paid-api-server.ts` - Benchmark API server with $0.001 pricing
- `setup-wallets.ts` - Creates and funds 10 test wallets
- `run-benchmark.ts` - Executes benchmarks at various TPS rates
- `README.md` - This file

## Prerequisites

1. **Facilitator running** on `http://localhost:8090`
2. **Master wallet** with USDC on Polygon (minimum 0.1 USDC for setup)
3. **Environment variables** configured

## Setup

### Step 1: Configure Environment

Create `.env` in the root directory with:

```bash
# Already configured from main setup
EVM_PRIVATE_KEY=your_facilitator_private_key
EVM_RPC_URL_POLYGON=your_polygon_rpc_url

# For wallet setup (the wallet with USDC to distribute)
MASTER_WALLET_PK=your_master_wallet_private_key_with_usdc
```

### Step 2: Create and Fund Wallets

This creates 10 new wallets and sends 0.01 USDC to each:

```bash
cd /Users/agada/facilitator
MASTER_WALLET_PK=your_pk_here bun run benchmarks/setup-wallets.ts
```

**Output:**
- `benchmarks/wallets.json` - Wallet addresses and private keys
- `benchmarks/wallets.env` - Environment variable format

**Total USDC transferred**: 0.1 USDC (10 wallets × 0.01 USDC)

### Step 3: Start the Paid API Server

In a new terminal:

```bash
cd /Users/agada/facilitator
bun run benchmarks/paid-api-server.ts
```

Server will start on `http://localhost:4030` with endpoints:
- `GET /api/benchmark` - Paid endpoint ($0.001 per request)
- `GET /api/health` - Free health check
- `GET /api/metrics` - View server metrics
- `POST /api/metrics/reset` - Reset metrics

### Step 4: Run Benchmarks

In another terminal:

```bash
cd /Users/agada/facilitator
bun run benchmarks/run-benchmark.ts
```

This will:
1. Load the 10 wallets from `wallets.json`
2. Initialize payment clients for each wallet
3. Run warmup requests
4. Execute tests at: 5, 10, 15, 20, 25, 30, 50 TPS
5. Save results to `benchmarks/results-[timestamp].json`

## Test Parameters

Each test runs for **30 seconds** at the specified TPS rate:

| TPS | Duration | Total Requests | Wallets Used |
|-----|----------|----------------|--------------|
| 5   | 30s      | 150           | Round-robin  |
| 10  | 30s      | 300           | Round-robin  |
| 15  | 30s      | 450           | Round-robin  |
| 20  | 30s      | 600           | Round-robin  |
| 25  | 30s      | 750           | Round-robin  |
| 30  | 30s      | 900           | Round-robin  |
| 50  | 30s      | 1500          | Round-robin  |

## Metrics Collected

### Per Request:
- Wallet index and address
- Request start/end time
- Total latency (ms)
- Success/failure status
- HTTP status code
- Transaction hash (if settled)
- Error messages

### Per Test:
- Total requests sent
- Successful requests
- Failed requests
- Average latency
- Min/Max latency
- P50, P95, P99 latency percentiles
- Actual TPS achieved
- Error rate percentage

## Results

Results are saved in JSON format with timestamp:

```
benchmarks/results-2025-01-01T12-30-45-123Z.json
```

### Result Structure:

```json
{
  "timestamp": "2025-01-01T12:30:45.123Z",
  "config": {
    "apiUrl": "http://localhost:4030",
    "facilitatorUrl": "http://localhost:8090",
    "tpsRates": [5, 10, 15, 20, 25, 30, 50],
    "durationSeconds": 30
  },
  "results": [
    {
      "tps": 5,
      "totalRequests": 150,
      "successfulRequests": 150,
      "failedRequests": 0,
      "avgLatency": 234.56,
      "p50Latency": 220.00,
      "p95Latency": 450.00,
      "p99Latency": 650.00,
      "errorRate": 0,
      "metrics": [...]
    }
  ]
}
```

## Understanding Results

### Latency Breakdown

Total request latency includes:

1. **Payment Creation** (~10-50ms)
   - Generate EIP-712 signature
   - Encode payment header

2. **Network Request** (~50-200ms)
   - HTTP request to paid API
   - Payment verification by facilitator
   - Content generation

3. **Settlement** (~2-5 seconds)
   - On-chain transaction submission
   - Block confirmation
   - Settlement response

### Expected Performance

For **Exact Scheme** on Polygon:

| Metric | Expected Range |
|--------|----------------|
| Avg Latency | 2-5 seconds |
| P95 Latency | 5-8 seconds |
| P99 Latency | 8-12 seconds |
| Success Rate | >95% |
| Max TPS | 20-30 (blockchain limited) |

## Troubleshooting

### Insufficient USDC
```
❌ Insufficient USDC balance. Need 0.1 USDC, have 0.05 USDC
```
**Solution**: Add more USDC to master wallet

### RPC Rate Limiting
```
❌ Error: 429 Too Many Requests
```
**Solution**: Use a dedicated RPC provider (Alchemy, Infura)

### Facilitator Not Running
```
❌ Failed to connect to http://localhost:8090
```
**Solution**: Start the facilitator with `bun dev`

### Gas Fees Too High
```
❌ Transaction failed: insufficient funds for gas
```
**Solution**: Ensure wallets have MATIC for gas (Polygon gas is cheap)

## Cost Analysis

### Setup Cost (One-time)
- 10 wallets × 0.01 USDC = **0.1 USDC**
- Gas for 10 transfers ≈ **$0.01**
- **Total**: ~$0.11

### Per Test Cost
- Example: 30s test at 20 TPS
- 600 requests × $0.001 = **0.6 USDC**
- Gas fees (Polygon) ≈ **$0.02**
- **Total per test**: ~$0.62

### Full Benchmark Suite Cost
- 7 tests (5, 10, 15, 20, 25, 30, 50 TPS)
- Total requests: ~4,050
- Total cost: **~$4.5 USDC**

## Advanced Usage

### Custom TPS Rates

Edit `run-benchmark.ts`:

```typescript
const config: BenchmarkConfig = {
  tpsRates: [1, 5, 10, 25, 50, 100], // Your custom rates
  durationSeconds: 60, // Longer tests
  // ...
};
```

### Single Test

Run one specific TPS rate:

```typescript
// In run-benchmark.ts, modify:
tpsRates: [20], // Test only 20 TPS
```

### More Wallets

Modify `setup-wallets.ts`:

```typescript
const NUM_WALLETS = 20; // Create 20 wallets
const AMOUNT_PER_WALLET = "0.02"; // Fund with more USDC
```

## Monitoring

### View Live Metrics

While benchmark is running:

```bash
# Server metrics
curl http://localhost:4030/api/metrics | jq .

# Facilitator status
curl http://localhost:8090/supported | jq .
```

### Reset Server Metrics

```bash
curl -X POST http://localhost:4030/api/metrics/reset
```

## Next Steps

1. **Analyze Results**: Review latency distributions and error rates
2. **Optimize**: Identify bottlenecks (network, RPC, blockchain)
3. **Scale Up**: Test with more wallets and higher TPS
4. **Compare Schemes**: Benchmark Upto scheme for comparison

## Contributing

To add new benchmarks:

1. Create a new test script in `benchmarks/`
2. Follow the naming convention: `test-[feature].ts`
3. Document in this README

---

**Questions?** Check the main project README or open an issue.

