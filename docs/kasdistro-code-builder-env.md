# code-builder (www.kasdistro.com) volume-bot API env

Production `www.kasdistro.com` currently serves the volume-bot UI as a route inside
the kasdistro SPA and runs the Express wallet API from the **code-builder** Vercel
project (`api/index.js` → `artifacts/api-server/deploy`).

That path is **not** the kasvolume Vercel project. If `DATABASE_URL` / `SESSION_SECRET`
are missing on **code-builder**, `/api/app/auth/verify` fails on
`insert into "wallet_users" ... on conflict ("wallet_address")` and Drizzle returns
only `Failed query: ...` (the real Postgres/driver cause is in `error.cause`).

Required Production env on Vercel project `kd-0751/code-builder` (same DB as Fly):

- `DATABASE_URL` — public Fly Postgres URL (`kasvolume-db.fly.dev:5432`, `sslmode=require`)
- `SESSION_SECRET` — wallet session HMAC secret
- `NODE_ENV=production`

Alternative architecture (documented in `kasdistro-vercel.proxy.json`): proxy
`/api/app/*`, `/api/bot/*`, and `/volume-bot/*` to `https://kasvolume.vercel.app`
and keep secrets only on the kasvolume project.
