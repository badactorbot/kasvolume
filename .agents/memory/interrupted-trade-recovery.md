---
name: Interrupted trade recovery
description: Safety rule for recovering a bot after its process stops during transaction submission.
---

Never clear an interrupted trade marker based only on elapsed time. Treat the RPC submission boundary as the safety boundary: pre-submission failures may release their marker; submission-attempted failures must retain it.

**Why:** The process can stop after broadcasting but before saving the transaction ID. Blindly retrying could submit a duplicate trade and spend twice.

**How to apply:** Acquire and transition markers atomically, and clear only the exact marker inspected. Query exhaustive accepted chain history from the marker's start time. Resume only when no outgoing wallet transaction exists; otherwise pause for explicit reconciliation.

Kaspa's address-history endpoint rejects a request containing both `before` and `after` (HTTP 400). Begin with the `after` lower bound, then page with `before` alone until the returned timestamps cross that original bound; incomplete or malformed history must fail closed.

Transient curve contention proven to occur before submission should clear its marker and retry with delay rather than pause permanently. An explicit user Stop must always win over an in-progress retry transition.