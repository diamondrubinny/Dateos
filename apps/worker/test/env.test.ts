// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { dashboardUrl } from '../src/env.js';

describe('the dashboard address in admin emails', () => {
  it('uses PUBLIC_ADMIN_URL when set', () => {
    expect(
      dashboardUrl({
        PUBLIC_ADMIN_URL: 'https://staff.example.org/',
        PUBLIC_APP_URL: 'https://example.org',
        CORS_ORIGINS: '',
      }),
    ).toBe('https://staff.example.org');
  });

  it('otherwise admin.<domain>, from the app address or the first CORS origin (install.sh)', () => {
    expect(
      dashboardUrl({
        PUBLIC_ADMIN_URL: '',
        PUBLIC_APP_URL: 'https://example.org',
        CORS_ORIGINS: '',
      }),
    ).toBe('https://admin.example.org');
    expect(
      dashboardUrl({
        PUBLIC_ADMIN_URL: '',
        PUBLIC_APP_URL: '',
        CORS_ORIGINS: 'https://example.org,https://admin.example.org',
      }),
    ).toBe('https://admin.example.org');
    expect(dashboardUrl({ PUBLIC_ADMIN_URL: '', PUBLIC_APP_URL: '', CORS_ORIGINS: '' })).toBe('');
  });
});
