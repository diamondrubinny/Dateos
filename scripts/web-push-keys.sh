#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
#
# Phase 60: a key pair for notifications in the web app (Web Push, VAPID: P-256), with OpenSSL
# only. Prints two .env lines. The private key belongs in the server's .env and nowhere else.
#   ./scripts/web-push-keys.sh >> .env
set -euo pipefail

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

pem="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null)"
# The private key: the 32 bytes after the 7-byte header of its SEC1 (RFC 5915) encoding.
private="$(printf '%s\n' "$pem" | openssl ec -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url)"
# The public key: the last 65 bytes (0x04 || X || Y) of its SubjectPublicKeyInfo.
public="$(printf '%s\n' "$pem" | openssl ec -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)"

[[ ${#private} -eq 43 && ${#public} -eq 87 && "$public" == B* ]] || {
  printf 'web-push-keys: OpenSSL gave unexpected keys\n' >&2
  exit 1
}
printf 'WEB_PUSH_PUBLIC_KEY=%s\nWEB_PUSH_PRIVATE_KEY=%s\n' "$public" "$private"
