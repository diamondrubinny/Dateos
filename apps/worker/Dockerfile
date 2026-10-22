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
# ffmpeg re-encodes voice messages (Debian security updates keep it patched: rebuild regularly).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node

CMD ["node", "dist/index.js"]
