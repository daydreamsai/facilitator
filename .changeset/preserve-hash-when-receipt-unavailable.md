---
"@daydreamsai/facilitator": patch
---

Return the transaction hash when a settlement was broadcast but its receipt could not be read.

Broadcasting and waiting for a receipt were sharing one `try`, so a dropped RPC connection or a slow receipt — after the transfer was already in the mempool — was reported as a plain failure with `transaction: ""`. The transfer would then land moments later while the caller held no reference to it, leaving money that had moved with nothing to reconcile or refund against.

The two now fail differently. A broadcast that never happened still returns no hash, because no money moved. A broadcast whose outcome is not yet known returns the hash with `errorReason: "settlement_receipt_unavailable"`, so the caller can poll for it rather than write the payment off.
