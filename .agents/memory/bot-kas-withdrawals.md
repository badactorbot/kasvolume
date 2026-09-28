---
name: Bot KAS withdrawals
description: Safety rules for moving KAS out of an isolated bot wallet.
---

Bot-wallet KAS withdrawals may only target the wallet address bound to the authenticated session. Never accept an arbitrary destination from the client. Specific-amount withdrawals use connected-wallet fee inputs. Max sweeps bot UTXOs only and deducts the fee from the received amount, after fresh transaction-bound KasWare message approval.

**Why:** The server controls the isolated wallet key, so destination integrity and duplicate-spend prevention must be enforced server-side. A mixed bot/connected-wallet Max withdrawal was rejected for an invalid signature, so the bot-only sweep avoids relying on fee-input co-signing while preserving explicit wallet approval.

**How to apply:** Require trading stopped, no in-flight operation, and no unsold managed positions. Users clear leftover inventory with `POST /app/bot/sell-all` (Sell All in the withdraw panel), which sells open managed lots FIFO via the bot key while trading is stopped. For Max, sign a one-output bot-only transaction and require a fresh KasWare signature over destination, net amount, fee, and operation identity; compare the submitted transaction exactly to the prepared one. For specific amounts, sign only bot inputs server-side and allow KasWare to sign only approved fee inputs; reject any other mutation. Retain the lock if submission outcome is uncertain, and keep an audit record after success.