---
name: Interrupted trade recovery
description: Safety rule for recovering a bot after its process stops during transaction submission.
---

Never clear an interrupted trade marker based only on elapsed time.

**Why:** The process can stop after broadcasting but before saving the transaction ID. Blindly retrying could submit a duplicate trade and spend twice.

**How to apply:** Query accepted chain history from the marker's start time. Resume only when no outgoing wallet transaction exists; otherwise pause for explicit reconciliation.