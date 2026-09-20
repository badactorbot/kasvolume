---
name: Kron scheduler hosting
description: Hosting requirement for continuous server-side trade scheduling.
---

Run production trading on an always-running Reserved VM, not an Autoscale deployment.

**Why:** The trade scheduler is a continuous background process. Autoscale can scale to zero during idle periods, which pauses scheduled trading until another request wakes the server.

**How to apply:** Before publishing trading changes, confirm the deployment type remains Reserved VM. Browser polling affects dashboard freshness only and must never be treated as the mechanism that keeps trading alive.