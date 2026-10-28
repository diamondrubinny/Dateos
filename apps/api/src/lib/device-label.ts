// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { DeviceKind, SignedInDevice } from '@nexaheart/shared';

/**
 * A coarse device code for "Your devices" (phase 29), computed once at sign-in: `app:android`,
 * `app:ios`, `web:<browser>:<os>` or `unknown`. Only the code is kept; the browser string itself
 * is never stored (data minimisation). Apps translate it.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  // The native app: React Native's networking stacks.
  if (/okhttp/i.test(ua)) return 'app:android';
  if (/CFNetwork|Darwin/i.test(ua)) return 'app:ios';
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'macOS'
          : /CrOS/i.test(ua)
            ? 'ChromeOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : '';
  // Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /SamsungBrowser/.test(ua)
          ? 'Samsung Internet'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : '';
  return browser || os ? `web:${browser}:${os}` : 'unknown';
}

/** The stored code as the API returns it. */
export function parseDeviceLabel(code: string | null): SignedInDevice['device'] {
  const [kind, a = '', b = ''] = (code ?? 'unknown').split(':');
  if (kind === 'app') return { kind: 'app', os: a === 'ios' ? 'iOS' : 'Android', browser: null };
  if (kind === 'web') return { kind: 'web', browser: a || null, os: b || null };
  return { kind: 'unknown' as DeviceKind, os: null, browser: null };
}
