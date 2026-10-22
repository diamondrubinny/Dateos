# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
# The public site: the web app (Expo export) and the moderation dashboard, served by Caddy with
# automatic HTTPS. Build from the repo root:
#   docker build -f infra/web/Dockerfile --build-arg API_URL=https://api.example.org .
FROM node:22-trixie-slim AS build
ARG API_URL=http://localhost:4000
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 \
    EXPO_PUBLIC_API_URL=${API_URL} VITE_API_URL=${API_URL}
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@nexaheart/shared \
  && pnpm --filter @nexaheart/admin build \
  && pnpm --filter @nexaheart/mobile build:web

FROM caddy:2.11.7-alpine AS runtime
COPY infra/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/mobile/dist /srv/app
COPY --from=build /repo/apps/admin/dist /srv/admin
# The license and its additional terms (the "Powered by NexaHeart" credit) travel with the image.
COPY --from=build /repo/LICENSE /repo/NOTICE /usr/share/licenses/nexaheart/
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later" \
  org.opencontainers.image.url="https://nexaheart.com"
EXPOSE 80 443
