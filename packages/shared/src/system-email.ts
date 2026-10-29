// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { creditHtml, creditLine } from './credit.js';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();

export interface BackupAlert {
  instanceName: string;
  /** The last recorded backup, or null if none ever was. */
  lastAt: Date | null;
  /** The dashboard's System page. */
  systemUrl: string;
}

/**
 * Phase 52: tells the community's admins that backups stopped. Hebrew and English in one email,
 * as staff may read either. No personal data: a time and where to look.
 */
export function backupAlertEmail(a: BackupAlert): { subject: string; text: string; html: string } {
  const name = oneLine(a.instanceName);
  const when = (locale: string) =>
    a.lastAt
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(a.lastAt) + ' UTC'
      : null;
  const he = {
    lead: a.lastAt
      ? `הגיבוי האחרון של ${name} הסתיים בתאריך ${when('he')}. מאז לא נרשם גיבוי חדש.`
      : `לא נרשם אף גיבוי של ${name}.`,
    what: 'בלי גיבוי, תקלה בשרת עלולה למחוק את כל המידע של הקהילה. כדאי לבדוק בשרת:',
    page: 'מצב המערכת בלוח הניהול:',
    footer: 'המייל הזה נשלח למנהלי הקהילה פעם ביום, עד שגיבוי חדש יירשם.',
  };
  const en = {
    lead: a.lastAt
      ? `The last backup of ${name} finished on ${when('en')}. None has been recorded since.`
      : `No backup of ${name} has been recorded.`,
    what: 'Without one, a server failure could lose all of your community’s data. On the server, check:',
    page: 'System status in the dashboard:',
    footer: 'This email goes to the community’s admins once a day until a new backup is recorded.',
  };
  const checks = [
    '/etc/cron.d/nexaheart-backup',
    '/var/log/nexaheart-backup.log',
    'cd /opt/nexaheart && ./scripts/backup.sh',
  ];
  const subject = `⚠️ ${name}: אין גיבוי עדכני · No recent backup`;
  const text = [
    he.lead,
    he.what,
    ...checks.map((c) => `  ${c}`),
    `${he.page} ${a.systemUrl}`,
    he.footer,
    '',
    '---',
    '',
    en.lead,
    en.what,
    ...checks.map((c) => `  ${c}`),
    `${en.page} ${a.systemUrl}`,
    en.footer,
    '',
    creditLine('en'),
  ].join('\n');
  const block = (t: typeof en, dir: 'rtl' | 'ltr', lang: string) =>
    `<div dir="${dir}" lang="${lang}">` +
    `<p><strong>${escapeHtml(t.lead)}</strong></p><p>${escapeHtml(t.what)}</p><ul>` +
    checks.map((c) => `<li><code dir="ltr">${escapeHtml(c)}</code></li>`).join('') +
    `</ul><p>${escapeHtml(t.page)} <a href="${escapeHtml(a.systemUrl)}" dir="ltr">` +
    `${escapeHtml(a.systemUrl)}</a></p>` +
    `<p style="color:#555;font-size:13px">${escapeHtml(t.footer)}</p></div>`;
  const html =
    `<div style="font-family:sans-serif;line-height:1.5">` +
    block(he, 'rtl', 'he') +
    '<hr>' +
    block(en, 'ltr', 'en') +
    `${creditHtml('en')}</div>`;
  return { subject, text, html };
}
