# Local Polygon Facilitator Setup

This branch (`local-polygon-setup`) is configured to run a local x402 facilitator with Polygon network support.

## Configuration

The facilitator is configured via `.env` file with:

- **Network**: Polygon mainnet only (`eip155:137`)
- **Signer**: Private key signer
- **Facilitator Address**: `0xBBc4344Bb405858959d81aB1DEadD7a13EC37E13`
- **RPC**: Tenderly gateway for Polygon
- **Port**: 8090

## Running the Facilitator

```bash
# Start the facilitator
bun dev
```

The facilitator will be available at `http://localhost:8090`

## Verify Setup

```bash
# Check supported networks and schemes
curl http://localhost:8090/supported
```

Expected response:
```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:137"
    },
    {
      "x402Version": 2,
      "scheme": "upto",
      "network": "eip155:137"
    }
  ],
  "signers": {
    "eip155:*": ["0xBBc4344Bb405858959d81aB1DEadD7a13EC37E13"]
  }
}
```

## Payment Schemes Supported

1. **Exact Scheme**: Immediate on-chain settlement for each payment
2. **Upto Scheme**: Batched payments using ERC-2612 permits

## Security Notes

- The `.env` file contains the private key and is **gitignored**
- Never commit the `.env` file to the repository
- Ensure the facilitator address has sufficient MATIC for gas fees

## Testing

To test the facilitator, you'll need:
1. A separate payer wallet with USDC on Polygon
2. A paid API server that uses this facilitator
3. A client that can make x402 payments

See the `examples/` directory for sample implementations.

