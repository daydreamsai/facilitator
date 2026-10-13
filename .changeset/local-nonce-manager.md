---
"@daydreamsai/facilitator": patch
---

Assign private-key signer nonces locally, and keep RPC keys and configured secrets out of logs.

Broadcasts from one signer were already serialised, but each send still read its nonce from the RPC's pending transaction count. Behind a load-balanced endpoint the node answering can lag the transaction just sent and return a nonce that is already used, so settlements failed with `replacement transaction underpriced` (reported as `transaction_failed`), with one nonce reused many times. The private-key signer now uses viem's nonce manager, which hands out nonces in sequence and never goes backwards on a lagging count. A nonce error resets the manager for that address and chain so the next send resyncs; the failed send still fails.

viem errors include the RPC URL (often carrying a provider API key) and the raw request body. `installLogRedaction()` routes console output and stdout/stderr writes through `redactSecrets()`, which strips `URL:` and `Request body:` content, path-embedded keys such as `/v2/<key>`, URL credentials, key-like query parameters, bearer tokens and the values of secret environment variables. The example server installs it before anything else runs.
