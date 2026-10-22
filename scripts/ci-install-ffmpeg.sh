#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
# CI only: installs ffmpeg and ffprobe on the GitHub runner. The Ubuntu package mirror sometimes
# hangs without failing, which left whole CI runs stuck for an hour; each apt attempt is time-boxed
# and retried. If apt still fails, a pinned static build (ffmpeg 6.0, from the ffmpeg-static
# project's GitHub release) is downloaded and checked against its SHA-256 before use.
set -euo pipefail
apt_opts=(-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
for attempt in 1 2; do
  if timeout 240 sudo apt-get "${apt_opts[@]}" update -qq &&
    timeout 240 sudo apt-get "${apt_opts[@]}" install -y -qq --no-install-recommends ffmpeg; then
    ffmpeg -version | head -1
    exit 0
  fi
  echo "ffmpeg install attempt ${attempt} failed or timed out; retrying" >&2
  sleep $((attempt * 10))
done

echo "apt failed; installing the pinned static build instead" >&2
release=https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0
dir=$(mktemp -d)
for tool in ffmpeg ffprobe; do
  curl -fsSL --retry 5 --retry-all-errors --max-time 300 -o "${dir}/${tool}.gz" \
    "${release}/${tool}-linux-x64.gz"
done
sha256sum -c - <<SUMS
17c1ae10b52ac499180679fe6ba77e17642390c4eedb0f1e3b0ac045da55128f  ${dir}/ffmpeg.gz
88ca6818d82a70e87de2bb6166026ad411528c72eda0e4e11ed25d185116ee17  ${dir}/ffprobe.gz
SUMS
for tool in ffmpeg ffprobe; do
  gunzip "${dir}/${tool}.gz"
  sudo install -m 0755 "${dir}/${tool}" "/usr/local/bin/${tool}"
done
ffmpeg -version | head -1
ffprobe -version | head -1
