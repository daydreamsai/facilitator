# @daydreamsai/facilitator

## 2.0.1

### Patch Changes

- d1b2208: Bound how long a settlement waits for its receipt.

  `waitForTransactionReceipt` was called without a timeout in both signers, and viem waits indefinitely by default. A transaction that stuck in the mempool — underpriced, or queued behind an earlier stuck nonce — held the request open long after the caller's own HTTP timeout had expired, so the caller learned nothing and the connection stayed open on a receipt nobody was waiting for.

  The wait is now bounded by `SETTLEMENT_RECEIPT_TIMEOUT_MS` (default 45s, configurable). Timing out is reported as `settlement_receipt_unavailable` with the transaction hash, which says the outcome is unknown rather than that the payment failed, and gives the caller the means to find it later.

- b1d8228: init
- 381e144: Return the transaction hash when a settlement was broadcast but its receipt could not be read.

  Broadcasting and waiting for a receipt were sharing one `try`, so a dropped RPC connection or a slow receipt — after the transfer was already in the mempool — was reported as a plain failure with `transaction: ""`. The transfer would then land moments later while the caller held no reference to it, leaving money that had moved with nothing to reconcile or refund against.

  The two now fail differently. A broadcast that never happened still returns no hash, because no money moved. A broadcast whose outcome is not yet known returns the hash with `errorReason: "settlement_receipt_unavailable"`, so the caller can poll for it rather than write the payment off.

- 8f5530b: Serialise on-chain broadcasts per signer so concurrent settlements cannot collide on a nonce.

  A signer holds one key, and a key has one nonce sequence. The nonce is resolved at send time from the chain's pending count, so two settlements starting before either had landed both read the same number and the second was rejected with `nonce too low` or `replacement transaction underpriced` — surfacing to the caller as `transaction_failed`. Two payers paying at the same moment was enough to trigger it.

  Broadcasts from one signer now run one at a time. Only the send is serialised, not the wait for a receipt: the nonce is consumed once the transaction is accepted into the mempool, so the next send starts as soon as the previous one has a hash.
