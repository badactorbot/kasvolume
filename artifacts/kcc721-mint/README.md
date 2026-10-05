# KCC721 mint

One-screen mint for a KCC721 v0.2 collection. The buyer connects Kasware and signs a single commit. The reveal is requested from the commit/reveal service and broadcast without a second signature.

This package does not call the Kasvolume trading API.

## Run the fixture

From the repo root:

```bash
pnpm install
pnpm --filter @workspace/kcc721-mint dev
```

Open `http://127.0.0.1:5174`. Fixture mode is the default (`VITE_MINT_MODE` unset or `fixture`). The dev server does not need a Kaspa node.

The fixture collection covenant id is `e7c721a4b19d0f6c3a58e2d1b0479c6e5f8a1d3b2c4e6f708192a3b4c5d6e7f0`. A different id belongs in the query: `?id=<64 hex>`. There is no ticker search.

| URL | What you should see |
| --- | --- |
| `/` | Kasware missing. Install link. No mint. |
| `/?scene=collection` | Connected on testnet-10, price, supply, Mint one |
| `/?scene=sold-out` | Supply full. Button reads Sold out and does not spin |
| `/?scene=revealing` | Commit accepted. Check reveal does not start a new payment |
| `/?scene=success` | Token, image, commit, reveal, NFT covenant id |
| `/?scene=wrong-network` | Wallet reports mainnet. Mint refused |
| `/?scene=insufficient` | Confirmed balance short. Unconfirmed is shown and ignored |
| `/?scene=rejected` | Kasware decline. Nothing broadcast |
| `/?scene=commit-rejected` | Commit not accepted. Copy says you were not charged |
| `/?scene=reveal-unavailable` | Ticket kept. Operator incident. No second payment |
| `/?scene=sold-out-race` | Controller sold-out error, no spinner |
| `/?scene=next-in-line` | Controller busy. Button does not fire another commit |
| `/?fixtureWallet=1` | Same fixture wallet, click Mint one to walk commit then reveal |

`pnpm --filter @workspace/kcc721-mint test` checks id widths, the network gate, the funding floor, and the server error mapping.

`pnpm --filter @workspace/kcc721-mint typecheck` and `pnpm --filter @workspace/kcc721-mint build` are the other checks.

## Point it at a real mint service

The browser adapter is `ReferenceCommitRevealClient` in `src/lib/commit-reveal.ts`. It speaks the proposal reference server (`reference/server.py` in [KaspaHUB21/KCC721-A-Kaspa-NFT-Covenant-Proposal](https://github.com/KaspaHUB21/KCC721-A-Kaspa-NFT-Covenant-Proposal) at `8d26173fce52d66555134550256b2e14fe6408b2`):

- `GET /api/kcc721/collection?id=`
- `POST /api/kcc721/prepare-mint`
- `GET /api/kcc721/mint-queue`
- `POST /api/kcc721/register-broadcast`
- `GET /api/kcc721/transaction?txid=`
- `POST /api/kcc721/prepare-reveal`

`signInputs` are taken from that response and passed to `kasware.signPskt`. The page does not choose a sighash or build a covenant. Reveal uses `pushTx` only.

```bash
VITE_MINT_MODE=live VITE_KASPA_NETWORK=testnet-10 VITE_MINT_API_URL=http://127.0.0.1:8112 pnpm --filter @workspace/kcc721-mint dev
```

Vite proxies `/api/kcc721` to `VITE_MINT_API_URL` and `/kaspa-rest` to `https://api-tn10.kaspa.org` (or `https://api.kaspa.org` when `VITE_KASPA_NETWORK=mainnet`). Open `/?id=<collection covenant id>`.

If the wallet network is not the site network, the page does not ask the service to prepare a transaction.

## What this environment cannot do

- No testnet-10 `kaspad` is available here, and there is no funded wallet, so a genesis, a paid commit, and a real reveal were not broadcast.
- The proposal engine pins Rust `1.91.0`. This image's default `rustc` is `1.83.0`. The mint page does not shell out to `kcc721-engine`; the reference server does that when you run it.
- The published reference server accepts `kaspa:` addresses and reads `https://api.kaspa.org`. It will not finish a testnet-10 mint until it is configured for testnet-10 and a reveal artifact exists for the collection.
