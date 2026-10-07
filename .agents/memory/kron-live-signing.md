---
name: Kron live signing
description: Signing and one-time locking rules learned from the first supervised Kron mainnet trade.
---

Use Kaspa's native `signTransaction` path for assembled Kron transactions and assert that covenant input scripts remain unchanged while funding inputs receive valid signature scripts. Capture and restore v1 `computeBudget` after signing because reassigning `tx.inputs` can drop it from the sighash.

**Why:** The Kron SDK `signFundingInputs` helper produced a malformed presence signature against the live node even though the key and assembled transaction were valid. Native signing produced the accepted transaction. Separately, multi-lot AMM pool sells often fail on-chain with the same "script ran, but verification failed" message; Sell All must fall back to one-lot (or consolidate-then-sell) instead of treating that reject as fatal for every lot shape.

**How to apply:** Prefer one-lot pool sells when more than one managed lot is open. Run a sign-only validation before submission, inspect only script lengths, and never log signature contents. For one-time execution, create a fail-closed pending lock before RPC submission and finalize it after acceptance; a post-submit-only lock can leave acceptance ambiguous if persistence fails.