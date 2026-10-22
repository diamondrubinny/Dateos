# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@nexaheart/api... \
  && pnpm --filter=@nexaheart/api deploy --prod --legacy /out

FROM node:22-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# The license and its additional terms (the "Powered by NexaHeart" credit) travel with the image.
COPY --from=build /repo/LICENSE /repo/NOTICE ./
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later" \
  org.opencontainers.image.url="https://nexaheart.com"
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
