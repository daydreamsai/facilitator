#!/usr/bin/env node
/**
 * x402 Facilitator Server CLI
 *
 * Run with: npx x402-facilitator
 * Or after global install: x402-facilitator
 *
 * Environment variables:
 * - PORT: Server port (default: 8090)
 * - CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET: For CDP signer
 * - EVM_PRIVATE_KEY, SVM_PRIVATE_KEY: For private key signer (fallback)
 * - EVM_RPC_URL_BASE, EVM_RPC_URL_BASE_SEPOLIA: RPC URLs
 */

import { app } from "./app.js";

const PORT = parseInt(process.env.PORT || "8090", 10);

app.listen(PORT);
console.log(`x402 Facilitator listening on http://localhost:${PORT}`);
