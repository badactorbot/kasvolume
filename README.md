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

## Production (Vercel)

`kasvolume-api-server` is **self-contained**: committed `artifacts/api-server/deploy/` + `package.vercel.json` (so `npm install` is not broken by pnpm `catalog:`/`workspace:*`). Set env: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`. Do **not** require `KRON_TOKEN_ID` — users enter the covenant/token ID in the console after wallet connect.

**Connect needs `/api` on the UI origin.** Prefer one project with Root Directory `.` (root `vercel.json`). Or Root Directory `artifacts/kron-trading-bot` with **Include source files outside Root Directory** enabled. Or UI-only + rewrite / `VITE_API_BASE_URL` to the Ready API host. Leave `VITE_API_BASE_URL` unset when API is colocated.

After API source changes: `pnpm --filter @workspace/api-server run build` and commit refreshed `deploy/` + `server/` bundles.

Do not point any env at Replit.

## Scripts

- `pnpm run typecheck` / `pnpm run build`
- `pnpm --filter @workspace/api-spec run codegen` after OpenAPI changes
