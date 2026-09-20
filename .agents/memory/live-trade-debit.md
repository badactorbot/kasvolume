---
name: Live trade debit calculation
description: How guarded Kron previews must calculate the wallet's real maximum debit.
---

For a Kron live preview, calculate the wallet debit from the assembled transaction's selected funding total minus its change output. Do not report `quote.total + networkFee` as the final debit.

**Why:** The curve quote and network fee do not include every wallet-funded covenant output. In particular, a recipient KCC20 output can require additional KAS dust, which materially changed the KDIST preview.

**How to apply:** After the final fee-sized assembly, derive the maximum debit from the assembly itself and itemize any difference from the quote as output dust or other transaction funding.