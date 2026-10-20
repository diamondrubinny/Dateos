# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:22-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@dateos/worker... \
  && pnpm --filter=@dateos/worker deploy --prod --legacy /out

FROM node:22-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node

CMD ["node", "dist/index.js"]
