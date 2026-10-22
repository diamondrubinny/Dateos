// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { CREDIT_TEXT, creditHtml, creditLine, creditText } from '../src/credit.js';

describe('software credit', () => {
  it('has the credit in every app language', () => {
    for (const locale of ['en', 'he', 'ar', 'ru'] as const) {
      expect(CREDIT_TEXT[locale].poweredBy, locale).toContain('NexaHeart');
      expect(CREDIT_TEXT[locale].openSource.length, locale).toBeGreaterThan(0);
    }
  });
  it('falls back to English and accepts regional tags', () => {
    expect(creditText('he-IL').poweredBy).toBe('מופעל על ידי NexaHeart');
    expect(creditText('fr').poweredBy).toBe('Powered by NexaHeart');
  });
  it('builds the email lines without a link', () => {
    expect(creditLine()).toBe('Powered by NexaHeart · Open source · nexaheart.com');
    expect(creditHtml('he')).toContain('dir="rtl"');
    expect(creditHtml('en')).not.toContain('<a ');
  });
});
