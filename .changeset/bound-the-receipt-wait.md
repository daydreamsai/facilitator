---
"@daydreamsai/facilitator": patch
---

Bound how long a settlement waits for its receipt.

`waitForTransactionReceipt` was called without a timeout in both signers, and viem waits indefinitely by default. A transaction that stuck in the mempool — underpriced, or queued behind an earlier stuck nonce — held the request open long after the caller's own HTTP timeout had expired, so the caller learned nothing and the connection stayed open on a receipt nobody was waiting for.

The wait is now bounded by `SETTLEMENT_RECEIPT_TIMEOUT_MS` (default 45s, configurable). Timing out is reported as `settlement_receipt_unavailable` with the transaction hash, which says the outcome is unknown rather than that the payment failed, and gives the caller the means to find it later.
