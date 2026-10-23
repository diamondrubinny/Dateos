// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/** Public build-time config. Never put secrets in EXPO_PUBLIC_* variables. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);
export const APP_SCHEME = 'nexaheart';

/**
 * The community's web app, for links people send to friends (phase 22: a friend's take, a pair
 * invitation). In the browser it's this site; native builds set EXPO_PUBLIC_WEB_URL.
 */
export function webUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
    return window.location.origin;
  }
  return (process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:8081').replace(/\/$/, '');
}
