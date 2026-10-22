#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
# CI only: installs ffmpeg on the GitHub runner. The Ubuntu package mirror sometimes hangs without
# failing, which left whole CI runs stuck for an hour; each attempt is now time-boxed and retried.
set -euo pipefail
apt_opts=(-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
for attempt in 1 2 3; do
  if timeout 240 sudo apt-get "${apt_opts[@]}" update -qq &&
    timeout 240 sudo apt-get "${apt_opts[@]}" install -y -qq --no-install-recommends ffmpeg; then
    ffmpeg -version | head -1
    exit 0
  fi
  echo "ffmpeg install attempt ${attempt} failed or timed out; retrying" >&2
  sleep $((attempt * 10))
done
echo "ffmpeg could not be installed after 3 attempts" >&2
exit 1
