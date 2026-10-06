# Kas volume (kasvolume)

Dry-run-first KCC20 trading console with Kasware wallet auth and user-funded bot wallets.

## Stack

- pnpm workspaces, Node.js 22+, TypeScript
- API: Express (`artifacts/api-server`)
- UI: Vite + React (`artifacts/kron-trading-bot`)
- DB: PostgreSQL + Drizzle (`lib/db`)

## Local run (same-origin `/api`)

1. Set env (see `.env.example`): `DATABASE_URL`, `SESSION_SECRET`, API `PORT=8080`. Token ID is entered in the UI (not a required env).
2. `pnpm install`
3. `pnpm --filter @workspace/db run push`
4. API: `PORT=8080 pnpm --filter @workspace/api-server run dev`
5. UI: `PORT=23486 BASE_PATH=/ pnpm --filter @workspace/kron-trading-bot run dev`
6. Open **http://127.0.0.1:23486/** — Vite proxies `/api` → `http://127.0.0.1:8080` (override with `VITE_API_PROXY_TARGET`).

Wallet connect calls `POST /api/app/auth/challenge` then `POST /api/app/auth/verify` on that same origin. There is **no Replit backend**.

## Production (Vercel) — UI / API only, not trading

Root `vercel.json` uses **Vercel Services** (one project, shared domain):

| Service | Path | Role |
| --- | --- | --- |
| `api-server` | `/api/*` | Express API (wallet auth, dashboard, sell-all) |
| `kron-trading-bot` | `/*` | Vite UI |

**Vercel project settings (required):**

1. **Root Directory:** `.` (repository root — not `artifacts/api-server` alone)
2. **Environment variables:** `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`
3. Do **not** set `KRON_TOKEN_ID` — users pick the token in the UI after connect
4. Leave `VITE_API_BASE_URL` unset (same-origin `/api`)

**Legacy fallback:** if Root Directory must stay `artifacts/kron-trading-bot`, enable **Include source files outside the Root Directory** and use that folder’s `vercel.json` (builds API + UI together).

After API source changes: `pnpm --filter @workspace/api-server run build` and commit refreshed `deploy/` + `server/` bundles.

Do not point any env at Replit. Do **not** rely on Vercel for continuous bot trading — use Fly for 24/7 bot runs ([`docs/always-on-hosting.md`](docs/always-on-hosting.md)).

## Scripts

- `pnpm run typecheck` / `pnpm run build`
- `pnpm --filter @workspace/api-spec run codegen` after OpenAPI changes
