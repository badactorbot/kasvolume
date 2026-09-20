---
name: Bot KAS withdrawals
description: Safety rules for moving KAS out of an isolated bot wallet.
---

Bot-wallet KAS withdrawals may only target the wallet address bound to the authenticated session. Never accept an arbitrary destination from the client. The connected wallet co-funds and signs the fee inputs so Max can transfer the bot's full balance.

**Why:** The server controls the isolated wallet key, so destination integrity and duplicate-spend prevention must be enforced server-side.

**How to apply:** Require trading stopped, no in-flight operation, and no unsold managed positions. Build one transaction with bot inputs plus connected-wallet fee inputs, sign only bot inputs server-side, let KasWare sign only the approved fee inputs, and reject any other mutation. Retain the lock if submission outcome is uncertain, and keep an audit record after success.