# Keep kasvolume alive 24/7

Trading uses an **in-process scheduler** (`setInterval` in the API).  
**Vercel serverless will not keep trades running.** Use an always-on host.

This repo ships one Docker image that serves:

- Vite UI (static)
- Express `/api`
- User bot automation scheduler

## Env (required)

| Name | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon, Supabase, Render, or Compose profile `with-db`) |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `PORT` | Usually `8080` (set by Docker/Fly/Render) |
| `STATIC_DIR` | `/app/public` in the image |
| `NODE_ENV` | `production` |

After first deploy, push the schema once from any machine with the same `DATABASE_URL`:

```bash
export DATABASE_URL=...
pnpm install
pnpm --filter @workspace/db run push
```

## Option A — Fly.io (recommended, cheapest always-on)

1. Install [flyctl](https://fly.io/docs/flyctl/install/) and `fly auth login`
2. Edit `fly.toml` `app = "..."` if the name is taken
3. `fly apps create <name>` (if new)
4. `fly secrets set DATABASE_URL='...' SESSION_SECRET='...'`
5. `fly deploy`
6. Open `https://<name>.fly.dev/`

`min_machines_running = 1` and `auto_stop_machines = "off"` keep the scheduler awake.

## Option B — Render Blueprint

1. [Render Dashboard](https://dashboard.render.com) → New → Blueprint
2. Connect `badactorbot/kasvolume`, use root `render.yaml`
3. Confirm `SESSION_SECRET` / Postgres are set
4. Deploy the `kasvolume` web service (Starter plan stays up; free web tiers can spin down)

## Option C — Docker on any VPS

```bash
export SESSION_SECRET="$(openssl rand -base64 48)"
export DATABASE_URL='postgresql://...'   # or use --profile with-db
docker compose --profile with-db up -d --build
# schema:
DATABASE_URL='postgresql://kasvolume:kasvolume@127.0.0.1:5432/kasvolume' \
  pnpm --filter @workspace/db run push
```

## What not to use for trading

| Host | OK for | Not OK for |
| --- | --- | --- |
| Vercel | static UI / occasional `/api` | continuous bot scheduler |
| This cloud agent VM | temporary testing | production 24/7 |
| Autoscale-to-zero PaaS | demos | live trading |

## Local check of the always-on image

```bash
docker compose --profile with-db up -d --build
curl -sS http://127.0.0.1:8080/api/healthz
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```
