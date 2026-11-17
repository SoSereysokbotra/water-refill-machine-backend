# Backend image (Phase 3.5 pilot). Build context = repository root:
#   docker build -f apps/api/Dockerfile -t wrm-api .
# Works on amd64 and arm64 (Oracle Ampere): build it on the server itself.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12.8.1

# Install only the API and its workspace dependencies (contracts, tsconfig)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter "@wrm/api..."

RUN pnpm --filter @wrm/contracts build \
  && pnpm --filter @wrm/api exec prisma generate \
  && pnpm --filter @wrm/api build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
# Keep the workspace layout: @wrm/contracts and the Prisma CLI (for migrate deploy) are resolved from it
COPY --from=build --chown=node:node /repo /repo
COPY --chown=node:node certs /repo/certs
USER node
WORKDIR /repo/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply database migrations, then start API + worker (RUN_MODE from .env)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]
