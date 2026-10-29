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
# Voice transcripts (phase 26) run ONNX Runtime on the CPU in Node: drop its GPU libraries
# (~340 MB), the builds for other systems, the browser runtime and the browser bundles.
RUN for bin in $(find /out/node_modules -type d -path '*onnxruntime-node/bin/napi-v*' -prune); do \
      for os in "$bin"/*; do [ "$(basename "$os")" = linux ] || rm -rf "$os"; done; \
    done \
  && find /out/node_modules -path '*onnxruntime-node/bin/*' \
    \( -name '*providers_cuda*' -o -name '*providers_tensorrt*' \) -delete \
  && find /out/node_modules -type d -name 'onnxruntime-web*' -prune -exec rm -rf {} + \
  && find /out/node_modules -path '*@huggingface/transformers/dist/*' \
    ! -name 'transformers.node.mjs' ! -name 'transformers.node.cjs' -type f -delete

FROM node:22-trixie-slim AS runtime
ENV NODE_ENV=production TRANSCRIPTS_CACHE=/models
# ffmpeg re-encodes voice messages (Debian security updates keep it patched: rebuild regularly).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The speech model (phase 26) is downloaded here once; compose mounts a volume.
RUN mkdir -p /models && chown node:node /models
COPY --from=build --chown=node:node /out ./
# The license and its additional terms (the "Powered by NexaHeart" credit) travel with the image.
COPY --from=build /repo/LICENSE /repo/NOTICE ./
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later" \
  org.opencontainers.image.url="https://nexaheart.com"
# The commit this image was built from (phase 53), so the dashboard can tell what's new. Last, so a
# new commit doesn't invalidate the cached layers above.
ARG GIT_COMMIT=
ENV APP_COMMIT=$GIT_COMMIT
USER node

CMD ["node", "dist/index.js"]
