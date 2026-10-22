# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:22-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@nexaheart/worker... \
  && pnpm --filter=@nexaheart/worker deploy --prod --legacy /out

FROM node:22-trixie-slim AS runtime
ENV NODE_ENV=production
# ffmpeg re-encodes voice messages (Debian security updates keep it patched: rebuild regularly).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# The license and its additional terms (the "Powered by NexaHeart" credit) travel with the image.
COPY --from=build /repo/LICENSE /repo/NOTICE ./
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later" \
  org.opencontainers.image.url="https://nexaheart.com"
USER node

CMD ["node", "dist/index.js"]
