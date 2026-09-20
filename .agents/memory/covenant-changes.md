---
name: Covenant changes
description: Safety and continuity rules for changing a bot's target covenant.
---

Changing covenant configuration must keep the connected wallet and isolated bot wallet, preserve trade history, and be blocked while any managed position is unsold or a trade is in progress.

**Why:** The user explicitly chose liquidation before switching, and carrying positions into a different covenant could strand assets or mislabel execution history.

**How to apply:** Stop trading, require zero open managed lots, snapshot the old token on historical lots, increment the configuration version, invalidate activation, and accept only a unique new 100 KAS activation transaction.