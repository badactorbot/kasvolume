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

**Recommended: one project** with **Root Directory = `.` (repository root)**. That serves the Vite UI and Express `/api` from the same deployment (see root `vercel.json`). Connect Wallet then hits same-origin `/api/app/auth/challenge` and `/api/app/auth/verify` — no dashboard rewrite and no `VITE_API_BASE_URL`.

| Setting | Value |
| --- | --- |
| Root Directory | `.` (leave empty / repo root) |
| Framework Preset | Other |
| Install / Build / Output | From root `vercel.json` (do not override) |

### Env on that project

- `DATABASE_URL`
- `SESSION_SECRET`
- `KRON_TOKEN_ID` (value in `.env.example`)
- `NODE_ENV=production`
- `BASE_PATH=/` (build, if you override the UI build)
- Leave `VITE_API_BASE_URL` unset

### Existing split projects (optional)

| Project root directory | Role |
| --- | --- |
| `artifacts/api-server` | API only (`api/index.js` + staged `app.mjs`) |
| `artifacts/kron-trading-bot` | UI **and** colocated `/api` serverless (preferred over rewrite) |

If you keep a **UI-only** project without the colocated function, add a rewrite:

- Source: `/api/:path*`
- Destination: `https://<your-api-deployment>/api/:path*`

**Alternative:** set frontend build env `VITE_API_BASE_URL=https://<your-api-deployment>` and on the API set `CORS_ORIGIN=https://<your-frontend>` plus `COOKIE_SAME_SITE=none`.

Do not point any env at Replit.

## Scripts

- `pnpm run typecheck` / `pnpm run build`
- `pnpm --filter @workspace/api-spec run codegen` after OpenAPI changes
