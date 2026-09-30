# SOL SI bot (`@workspace/sol-si-bot`)

Live-capable **Jupiter Perps** bot scaffold for **SOL-PERP** only.  
Default **`DRY_RUN=true`** — first boot logs intents and does **not** place orders until you flip it.

**This is not a profit promise.** At **10×** leverage, liquidation / adverse moves can wipe the dedicated bot wallet. Daily loss kill and emergency flatten limit how long a bad day runs; they do not make trading safe.

## What it does

| Module | Role |
| --- | --- |
| `src/config.ts` | Env-driven config (`DRY_RUN`, `MAX_LEVERAGE=10`, daily kill %, etc.) |
| `src/market/jupiter.ts` | Jupiter Perps HTTP client + market snapshot |
| `src/market/candles.ts` | **1h OHLCV** via Binance public klines (`SOLUSDT`) |
| `src/strategy/trend-regime.ts` | EMA trend + ATR% regime on those candles |
| `src/risk/manager.ts` | 10× cap, daily loss kill, drawdown pause, flatten |
| `src/execution/jupiter-perps.ts` | increase / close-all via Perps API; DRY_RUN logs only |
| `src/alerts/discord.ts` | Discord webhook alerts |
| `src/index.ts` | Main poll loop |

## Create a dedicated bot wallet

Use a **new** Solana keypair. Never reuse your main wallet.

```bash
# Example with Solana CLI
solana-keygen new --outfile ~/secrets/sol-si-bot.json --no-bip39-passphrase
chmod 600 ~/secrets/sol-si-bot.json
solana-keygen pubkey ~/secrets/sol-si-bot.json
```

Or generate in a trusted offline tool and store base58 / JSON bytes in a secret manager.

Fund that address with:

1. **USDC** (collateral for Jupiter Perps) — start small for first live tests.
2. A little **SOL** for fees / priority.

## Configure secrets (home host)

```bash
cd artifacts/sol-si-bot
cp .env.example .env
chmod 600 .env
```

Fill in:

| Variable | What |
| --- | --- |
| `RPC_URL` | Reliable mainnet RPC (Helius / QuickNode / etc.) |
| `SOLANA_PRIVATE_KEY` **or** `KEYPAIR_PATH` | Dedicated bot key only |
| `DISCORD_WEBHOOK_URL` | Discord channel webhook |
| `DRY_RUN` | Keep `true` until ready |
| `MAX_LEVERAGE` | Locked default `10` |
| `COLLATERAL_USDC` | Size per new entry (start tiny) |
| `DAILY_LOSS_KILL_PCT` | Flatten + pause (default 5) |
| `CANDLE_*` | Optional overrides for 1h feed (see below) |

**Never commit `.env` or key files.**

## Candle feed (trend + regime)

Strategy EMAs / ATR use **public Binance 1h klines** for `SOLUSDT` — no API key.

| Variable | Default | Notes |
| --- | --- | --- |
| `CANDLE_SOURCE` | `binance` | Only source wired today |
| `CANDLE_BASE_URL` | `https://data-api.binance.vision` | Market-data-only host (no key). Avoid `api.binance.com` if your region blocks it. |
| `CANDLE_SYMBOL` | `SOLUSDT` | SOL-only proxy for regime |
| `CANDLE_INTERVAL` | `1h` | Decision bar |
| `CANDLE_LIMIT` | `120` | Bars fetched each poll (need ≥ `EMA_SLOW` + ATR warm-up) |

This is a **CEX price proxy**, not Jupiter’s oracle. Marks/liquidation still come from Jupiter; candles drive signal direction only.

## Install & run

From repo root (pnpm workspace):

```bash
pnpm install
pnpm --filter @workspace/sol-si-bot start
```

Or inside the package:

```bash
pnpm install
pnpm start
```

### Flip live

1. Run with `DRY_RUN=true` until Discord heartbeats and intent logs look sane.  
2. Confirm wallet has USDC + SOL.  
3. Set `DRY_RUN=false` in `.env` and restart.  
4. Prefer tiny `COLLATERAL_USDC` for the first live open/close.

### Emergency flatten (home)

Send `SIGUSR1` to the process (`kill -USR1 <pid>`). Risk manager sets emergency + flatten intent. Keep a Discord alert path so you know it fired.

## Jupiter Perps notes

- Base URL: `https://perps-api.jup.ag/v1` with header `x-perps-api-version: v2`.
- Live paths used here: `GET /market-stats`, `GET /positions`, `POST /positions/increase|decrease|close-all`, `POST /transaction/execute` (see [OpenAPI](https://perps-api.jup.ag/v1/docs)).
- Flow: API builds unsigned tx → bot signs → `/transaction/execute` → **keeper** fulfills (not instant).
- Amounts: USDC raw ×1e6; leverage as string; slippage in bps; new positions need ~**$10** min collateral.

## Honest limits of this scaffold

- No guaranteed fills, PnL, or uptime.
- Candles are Binance spot `SOLUSDT`, not on-chain Jupiter marks — basis can diverge.
- Position/equity parsing is best-effort against evolving API shapes.
- 10× can zero the wallet; only fund what you can lose.

## Local verify (DRY_RUN)

```bash
cd artifacts/sol-si-bot
cp .env.example .env   # leave DRY_RUN=true; no keys needed for candle smoke
pnpm install
pnpm start
```

Expect logs like:

- `Candles: binance SOLUSDT 1h via https://data-api.binance.vision`
- `[tick] ... candles=120 lastClose=... signal=long|short|flat|hold (...not "insufficient candle...")`

`hold` from chop/borrow is fine; **empty-candle hold** is not. Ctrl+C to stop.
