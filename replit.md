# Kron Trading Bot

A dry-run-first control dashboard for a clock-based KCC20 trading strategy on Kron.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/kron-trading-bot run dev` — run the web dashboard through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/kron-trading-bot/` — React dashboard
- `artifacts/api-server/src/lib/bot-service.ts` — scheduler and dry-run strategy engine
- `artifacts/api-server/src/routes/bot.ts` — bot API routes
- `lib/api-spec/openapi.yaml` — API contract and generated client source

## Architecture decisions

- Dry-run is the default and the only executable mode until a dedicated wallet signer is configured.
- The cycle advances through configurable buy and sell counts, initially 10 buys followed by 2 sells.
- Hourly trade caps and a stop control are enforced server-side rather than relying on the browser.
- Live Kron integration should use the official `@kronsdk/kron-sdk`; never automate website clicks or expose wallet material to the client.

## Product

- Configure cycle counts, trades per hour, order size, slippage, loss limit, and reserve.
- Start and stop the dry-run scheduler or execute one simulated strategy step.
- Monitor cycle progress, safety status, market placeholders, and recent activity.
- Live mode remains visibly locked until the token and signer integration are completed.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Re-run API codegen after every OpenAPI change.
- Add `dom.iterable` to the generated client TypeScript library set because generated headers handling uses `Headers.entries()`.
- Never place a seed phrase or private key in source code, browser storage, logs, or chat.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
