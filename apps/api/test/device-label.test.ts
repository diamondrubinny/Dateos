// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { deviceLabel, parseDeviceLabel } from '../src/lib/device-label.js';

describe('deviceLabel', () => {
  it.each([
    ['okhttp/4.12.0', 'app:android'],
    ['NexaHeart/1 CFNetwork/1568.100.1 Darwin/24.0.0', 'app:ios'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'web:Chrome:Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      'web:Edge:Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'web:Safari:macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
      'web:Chrome:iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36',
      'web:Samsung Internet:Android',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'web:Firefox:Linux'],
    ['', 'unknown'],
    [null, 'unknown'],
  ])('%s → %s', (ua, code) => {
    expect(deviceLabel(ua)).toBe(code);
    // Fits the column.
    expect(deviceLabel(ua).length).toBeLessThanOrEqual(40);
  });

  it('parses the stored code for the API', () => {
    expect(parseDeviceLabel('app:ios')).toEqual({ kind: 'app', os: 'iOS', browser: null });
    expect(parseDeviceLabel('web:Firefox:Linux')).toEqual({
      kind: 'web',
      browser: 'Firefox',
      os: 'Linux',
    });
    expect(parseDeviceLabel('web::Windows')).toEqual({ kind: 'web', browser: null, os: 'Windows' });
    expect(parseDeviceLabel(null)).toEqual({ kind: 'unknown', os: null, browser: null });
  });
});
