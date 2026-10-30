// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { backupAlertEmail, updateAvailableEmail, updateResultEmail } from '../src/system-email.js';

describe('backup alert email (phase 52)', () => {
  const url = 'https://admin.example.org/#/system';

  it('is in Hebrew and English, with what to check and the System page', () => {
    const m = backupAlertEmail({ instanceName: 'Ahava', lastAt: null, systemUrl: url });
    expect(m.subject).toBe('⚠️ Ahava: אין גיבוי עדכני · No recent backup');
    expect(m.text).toContain('לא נרשם אף גיבוי של Ahava.');
    expect(m.text).toContain('No backup of Ahava has been recorded.');
    expect(m.text).toContain('cd /opt/nexaheart && ./scripts/backup.sh');
    expect(m.html).toContain('<div dir="rtl" lang="he">');
    expect(m.html).toContain('<div dir="ltr" lang="en">');
    expect(m.html).toContain(`<a href="${url}" dir="ltr">`);
  });

  it('names the time of the last backup, in UTC', () => {
    const m = backupAlertEmail({
      instanceName: 'Ahava',
      lastAt: new Date('2026-10-27T03:17:00Z'),
      systemUrl: url,
    });
    expect(m.text).toContain('The last backup of Ahava finished on Oct 27, 2026, 3:17 AM UTC.');
  });

  it('escapes the community name in HTML, and keeps it on one line in the subject', () => {
    const m = backupAlertEmail({
      instanceName: '<b>Evil</b>\r\nBcc: x@example.org',
      lastAt: null,
      systemUrl: url,
    });
    expect(m.html).not.toContain('<b>Evil');
    expect(m.html).toContain('&#60;b&#62;Evil');
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe('update emails (phase 54)', () => {
  const url = 'https://admin.example.org/#/system';
  const change = (n: number) => ({ title: `Change number ${n}`, number: n });

  it('lists what was added or fixed, links the pull requests and the dashboard', () => {
    const m = updateAvailableEmail({
      instanceName: 'Ahava',
      changes: [change(62), { title: 'A direct commit', number: null }],
      behind: 5,
      repo: 'diamondrubinny/NexaHeart',
      systemUrl: url,
    });
    expect(m.subject).toBe('Ahava: יש עדכון · Update available');
    expect(m.text).toContain('2 שינויים חדשים מחכים לאישור בקהילה Ahava.');
    expect(m.text).toContain('An update is available for Ahava: 2 changes.');
    expect(m.text).toContain('  • Change number 62 (#62)');
    expect(m.text).toContain('  • A direct commit\n');
    expect(m.text).toContain(url);
    expect(m.html).toContain(
      '<li dir="ltr">Change number 62 (<a href="https://github.com/diamondrubinny/NexaHeart/pull/62">#62</a>)</li>',
    );
    // Nothing to click that installs: the only links are the pull requests and the dashboard.
    const links = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
    expect(new Set(links)).toEqual(
      new Set(['https://github.com/diamondrubinny/NexaHeart/pull/62', url]),
    );
  });

  it('shows the first 10 changes and counts the rest; one change reads naturally', () => {
    const many = updateAvailableEmail({
      instanceName: 'Ahava',
      changes: Array.from({ length: 13 }, (_, i) => change(100 - i)),
      behind: 30,
      repo: 'o/r',
      systemUrl: url,
    });
    expect(many.text).toContain('Change number 91 (#91)');
    expect(many.text).not.toContain('Change number 90');
    expect(many.text).toContain('ועוד 3.');
    expect(many.text).toContain('And 3 more.');
    const one = updateAvailableEmail({
      instanceName: 'Ahava',
      changes: [change(1)],
      behind: 1,
      repo: 'o/r',
      systemUrl: url,
    });
    expect(one.text).toContain('שינוי חדש אחד מחכה לאישור בקהילה Ahava.');
    expect(one.html).toContain(
      '<strong>שינוי חדש אחד מחכה לאישור בקהילה <bdi>Ahava</bdi>.</strong>',
    );
    expect(one.text).toContain('1 change.');
  });

  it('escapes change titles in HTML and keeps them on one line', () => {
    const m = updateAvailableEmail({
      instanceName: 'Ahava',
      changes: [{ title: '<img src=x onerror=alert(1)>\nSecond', number: 7 }],
      behind: 1,
      repo: 'o/r',
      systemUrl: url,
    });
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&#60;img');
    expect(m.text).toContain('<img src=x onerror=alert(1)> Second (#7)');
  });

  it('the result: installed, or not with what the server said', () => {
    const ok = updateResultEmail({
      instanceName: 'Ahava',
      status: 'done',
      message: 'Installed b0771a1 (was cb33e14).',
      systemUrl: url,
    });
    expect(ok.subject).toBe('Ahava: העדכון הותקן · Update installed');
    expect(ok.text).toContain('The update of Ahava is installed.');
    expect(ok.text).toContain('Installed b0771a1 (was cb33e14).');
    const failed = updateResultEmail({
      instanceName: 'Ahava',
      status: 'failed',
      message: 'The new version didn’t start, so the server went back to b0771a1.',
      systemUrl: url,
    });
    expect(failed.subject).toBe('⚠️ Ahava: העדכון לא הותקן · Update not installed');
    expect(failed.text).toContain('העדכון של Ahava לא הותקן.');
    expect(failed.text).toContain('The site keeps running the previous version.');
    expect(failed.html).toContain('<blockquote dir="ltr" lang="en">The new version didn’t start');
  });
});
