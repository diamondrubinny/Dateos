// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Platform } from 'react-native';

/**
 * Phase 57: on the web, registers the service worker the build writes (scripts/web-pwa.mjs), so
 * the app can be installed and opens when the server or the connection is away. Not in
 * development (the dev server has no sw.js), and never on native.
 */
export function registerServiceWorker(): void {
  if (Platform.OS !== 'web' || __DEV__) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}
