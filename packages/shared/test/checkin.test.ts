// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { checkinInputSchema, maskEmail, waitingForMyReply } from '../src/checkin.js';

const base = {
  place: 'Café Puaa, Jaffa',
  startsAt: '2026-10-22T18:00:00.000Z',
  checkAt: '2026-10-22T20:00:00.000Z',
  contactName: 'Dana',
  contactEmail: 'dana@example.org',
  locale: 'en' as const,
  timeZone: 'Asia/Jerusalem',
};

describe('check-in input', () => {
  it('accepts a normal date and rejects bad windows', () => {
    expect(checkinInputSchema.safeParse(base).success).toBe(true);
    expect(
      checkinInputSchema.safeParse({ ...base, checkAt: '2026-10-22T18:05:00.000Z' }).success,
    ).toBe(false); // < 15 min
    expect(
      checkinInputSchema.safeParse({ ...base, checkAt: '2026-10-23T08:00:00.000Z' }).success,
    ).toBe(false); // > 12 h
    expect(checkinInputSchema.safeParse({ ...base, contactEmail: 'nope' }).success).toBe(false);
    expect(checkinInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(checkinInputSchema.safeParse({ ...base, timeZone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('masks the contact address', () => {
    expect(maskEmail('dana@example.org')).toBe('d***@example.org');
    expect(maskEmail('@x')).toBe('***');
  });
});

describe('anti-ghosting reminder', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  it('only when the other person wrote last, at least 3 days ago', () => {
    expect(waitingForMyReply(null, now)).toBe(false);
    expect(waitingForMyReply({ mine: true, createdAt: '2026-10-10T12:00:00Z' }, now)).toBe(false);
    expect(waitingForMyReply({ mine: false, createdAt: '2026-10-20T12:00:00Z' }, now)).toBe(false);
    expect(waitingForMyReply({ mine: false, createdAt: '2026-10-19T12:00:00Z' }, now)).toBe(true);
  });
});

describe('check-in alert email', () => {
  const alert = {
    instanceName: 'Ahava',
    memberName: 'Noa',
    contactName: 'Dana',
    matchName: 'Dan',
    place: 'Café <b>Puaa</b>, Jaffa',
    note: 'He has a red bike\nSubject: fake',
    startsAt: new Date('2026-10-22T16:00:00Z'),
    checkAt: new Date('2026-10-22T18:00:00Z'),
    locale: 'en' as const,
    timeZone: 'Asia/Jerusalem',
    sos: false,
  };
  it('quotes what the member wrote, escaped, without links, in local time', async () => {
    const { checkinAlertEmail } = await import('../src/checkin-email.js');
    const mail = checkinAlertEmail(alert);
    expect(mail.subject).toBe('Ahava: Noa did not check in after a date');
    expect(mail.text).toContain('Place: Café <b>Puaa</b>, Jaffa');
    expect(mail.text).toContain('9:00 PM'); // 18:00 UTC in Jerusalem (summer time)
    expect(mail.text).toContain('Note: He has a red bike Subject: fake'); // no injected lines
    expect(mail.html).toContain('Café &#60;b&#62;Puaa&#60;/b&#62;');
    expect(mail.html).not.toContain('<b>');
    expect(mail.text + mail.html).not.toMatch(/https?:\/\//);
    // The software credit, as plain text (license term, see NOTICE).
    expect(mail.text.trimEnd().endsWith('Powered by NexaHeart · Open source · nexaheart.com')).toBe(
      true,
    );
    expect(mail.html).toContain('Powered by NexaHeart · Open source · nexaheart.com');
  });
  it('has an urgent SOS version in every language', async () => {
    const { checkinAlertEmail } = await import('../src/checkin-email.js');
    for (const locale of ['en', 'he', 'ar', 'ru'] as const) {
      const mail = checkinAlertEmail({ ...alert, locale, sos: true });
      expect(mail.subject, locale).toContain('SOS');
      expect(mail.text, locale).toContain('Noa');
      expect(mail.html, locale).toContain(
        locale === 'he' || locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"',
      );
    }
  });
});
