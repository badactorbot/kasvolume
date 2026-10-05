# Always-on image: Express API + trade scheduler + Vite UI (same origin /api).
# Vercel serverless cannot keep the in-process scheduler alive — use this instead.

FROM node:22-bookworm-slim AS base
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/kron-trading-bot/package.json ./artifacts/kron-trading-bot/
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY scripts/package.json ./scripts/
# mockup-sandbox is excluded from the image; workspace glob simply skips it.
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm run typecheck:libs \
  && pnpm --filter @workspace/api-server run build \
  && BASE_PATH=/ pnpm --filter @workspace/kron-trading-bot run build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/public
WORKDIR /app

# Bundled API (esbuild) only needs @kronsdk/kron-sdk at runtime (externalized).
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/kron-trading-bot/dist/public ./public
RUN npm install --omit=dev @kronsdk/kron-sdk@0.18.2

EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
