// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { backupAlertEmail } from '../src/system-email.js';

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
