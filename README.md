# Kas volume (kasvolume)

Dry-run-first KCC20 trading console with Kasware wallet auth and user-funded bot wallets.

## Stack

- pnpm workspaces, Node.js 22+, TypeScript
- API: Express (`artifacts/api-server`)
- UI: Vite + React (`artifacts/kron-trading-bot`)
- DB: PostgreSQL + Drizzle (`lib/db`)

## Local run (same-origin `/api`)

1. Set env (see `.env.example`): `DATABASE_URL`, `SESSION_SECRET`, `KRON_TOKEN_ID`, API `PORT=8080`.
2. `pnpm install`
3. `pnpm --filter @workspace/db run push`
4. API: `PORT=8080 pnpm --filter @workspace/api-server run dev`
5. UI: `PORT=23486 BASE_PATH=/ pnpm --filter @workspace/kron-trading-bot run dev`
6. Open **http://127.0.0.1:23486/** — Vite proxies `/api` → `http://127.0.0.1:8080` (override with `VITE_API_PROXY_TARGET`).

Wallet connect calls `POST /api/app/auth/challenge` then `POST /api/app/auth/verify` on that same origin. There is **no Replit backend**.

## Production (Vercel)

Two projects (already used by this repo’s team):

| Project root directory | Role |
| --- | --- |
| `artifacts/api-server` | API (`vercel.json` builds + serverless `api/index.ts`) |
| `artifacts/kron-trading-bot` | Static UI |

**Preferred:** keep the browser on same-origin `/api` by adding a Vercel rewrite on the **frontend** project:

- Source: `/api/:path*`
- Destination: `https://<your-api-deployment>/api/:path*`

Leave `VITE_API_BASE_URL` unset.

**Alternative:** set frontend build env `VITE_API_BASE_URL=https://<your-api-deployment>` and on the API set `CORS_ORIGIN=https://<your-frontend>` plus `COOKIE_SAME_SITE=none`.

### API env (Vercel → kasvolume-api-server)

- `DATABASE_URL`
- `SESSION_SECRET`
- `KRON_TOKEN_ID` (value in `.env.example`)
- `NODE_ENV=production`
- Optional: `CORS_ORIGIN`, `COOKIE_SAME_SITE` (only if UI uses absolute `VITE_API_BASE_URL`)

### Frontend env (Vercel → UI project)

- `BASE_PATH=/` (build)
- Optional: `VITE_API_BASE_URL` only if not using a same-origin `/api` rewrite

Do not point any env at Replit.

## Scripts

- `pnpm run typecheck` / `pnpm run build`
- `pnpm --filter @workspace/api-spec run codegen` after OpenAPI changes
