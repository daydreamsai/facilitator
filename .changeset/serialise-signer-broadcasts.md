---
"@daydreamsai/facilitator": patch
---

Serialise on-chain broadcasts per signer so concurrent settlements cannot collide on a nonce.

A signer holds one key, and a key has one nonce sequence. The nonce is resolved at send time from the chain's pending count, so two settlements starting before either had landed both read the same number and the second was rejected with `nonce too low` or `replacement transaction underpriced` — surfacing to the caller as `transaction_failed`. Two payers paying at the same moment was enough to trigger it.

Broadcasts from one signer now run one at a time. Only the send is serialised, not the wait for a receipt: the nonce is consumed once the transaction is accepted into the mempool, so the next send starts as soon as the previous one has a hash.
