---
name: Kron live signing
description: Signing and one-time locking rules learned from the first supervised Kron mainnet trade.
---

Use Kaspa's native `signTransaction` path for assembled Kron transactions and assert that covenant input scripts remain unchanged while funding inputs receive valid signature scripts.

**Why:** The Kron SDK funding-input helper produced a malformed signature against the live node even though the key and assembled transaction were valid. Native signing produced the accepted transaction.

**How to apply:** Run a sign-only validation before submission, inspect only script lengths, and never log signature contents. For one-time execution, create a fail-closed pending lock before RPC submission and finalize it after acceptance; a post-submit-only lock can leave acceptance ambiguous if persistence fails.