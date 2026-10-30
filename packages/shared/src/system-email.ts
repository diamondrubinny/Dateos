// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { creditHtml, creditLine } from './credit.js';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();
/** Escapes a sentence and isolates the community's name in it (`<bdi>`), so a Latin name doesn't
 * pull the punctuation and numbers around it into its direction in Hebrew. */
const withName = (sentence: string, name: string) =>
  name
    ? escapeHtml(sentence)
        .split(escapeHtml(name))
        .join(`<bdi>${escapeHtml(name)}</bdi>`)
    : escapeHtml(sentence);

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
    `<p><strong>${withName(t.lead, name)}</strong></p><p>${escapeHtml(t.what)}</p><ul>` +
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

/** Changes listed in the "update available" email; the rest are counted. */
export const UPDATE_EMAIL_CHANGES = 10;

export interface UpdateAvailable {
  instanceName: string;
  /** What's new, newest first (phase 53), as plain text. */
  changes: { title: string; number: number | null }[];
  /** Commits the branch is ahead, for when it was updated without pull requests. */
  behind: number;
  /** `owner/name` on GitHub (UPDATE_REPO), for links to the pull requests. */
  repo: string;
  systemUrl: string;
}

/**
 * Phase 54: a new version is available. What was added or fixed, and where to approve it. The
 * email itself installs nothing (no action links): approving needs the dashboard.
 */
export function updateAvailableEmail(u: UpdateAvailable): {
  subject: string;
  text: string;
  html: string;
} {
  const name = oneLine(u.instanceName);
  const shown = u.changes.slice(0, UPDATE_EMAIL_CHANGES);
  const more = u.changes.length - shown.length;
  const count = u.changes.length || u.behind;
  const he = {
    lead:
      count === 1
        ? `שינוי חדש אחד מחכה לאישור בקהילה ${name}.`
        : `${count} שינויים חדשים מחכים לאישור בקהילה ${name}.`,
    list: 'מה נוסף או תוקן:',
    more: `ועוד ${more}.`,
    page: 'לפרטים ולאישור ההתקנה, בלוח הניהול:',
    footer:
      'שום דבר לא מותקן בלי אישור של מנהל/ת בלוח הניהול. השרת מגבה לפני ההתקנה, וחוזר לגרסה הקודמת אם החדשה לא עולה. המייל נשלח למנהלי הקהילה פעם ביום לכל היותר.',
  };
  const en = {
    lead:
      count === 1
        ? `An update is available for ${name}: 1 change.`
        : `An update is available for ${name}: ${count} changes.`,
    list: 'What was added or fixed:',
    more: `And ${more} more.`,
    page: 'Details, and approving the install, in the dashboard:',
    footer:
      'Nothing installs without an admin’s approval in the dashboard. The server backs up first, and goes back to the previous version if the new one doesn’t start. This email goes to the community’s admins at most once a day.',
  };
  const label = (c: { title: string; number: number | null }) =>
    c.number === null ? oneLine(c.title) : `${oneLine(c.title)} (#${c.number})`;
  const prUrl = (n: number) => `https://github.com/${u.repo}/pull/${n}`;
  const subject = `${name}: יש עדכון · Update available`;
  const textBlock = (t: typeof en) => [
    t.lead,
    ...(shown.length ? [t.list, ...shown.map((c) => `  • ${label(c)}`)] : []),
    ...(more > 0 ? [t.more] : []),
    `${t.page} ${u.systemUrl}`,
    t.footer,
  ];
  const text = [...textBlock(he), '', '---', '', ...textBlock(en), '', creditLine('en')].join('\n');
  // Change titles are in English: each item is its own left-to-right line, also in Hebrew.
  const items = shown
    .map(
      (c) =>
        `<li dir="ltr">${escapeHtml(oneLine(c.title))}` +
        (c.number === null ? '' : ` (<a href="${escapeHtml(prUrl(c.number))}">#${c.number}</a>)`) +
        '</li>',
    )
    .join('');
  const block = (t: typeof en, dir: 'rtl' | 'ltr', lang: string) =>
    `<div dir="${dir}" lang="${lang}">` +
    `<p><strong>${withName(t.lead, name)}</strong></p>` +
    (shown.length ? `<p>${escapeHtml(t.list)}</p><ul>${items}</ul>` : '') +
    (more > 0 ? `<p>${escapeHtml(t.more)}</p>` : '') +
    `<p>${escapeHtml(t.page)} <a href="${escapeHtml(u.systemUrl)}" dir="ltr">` +
    `${escapeHtml(u.systemUrl)}</a></p>` +
    `<p style="color:#555;font-size:13px">${escapeHtml(t.footer)}</p></div>`;
  const html =
    `<div style="font-family:sans-serif;line-height:1.5">` +
    block(he, 'rtl', 'he') +
    '<hr>' +
    block(en, 'ltr', 'en') +
    `${creditHtml('en')}</div>`;
  return { subject, text, html };
}

export interface UpdateResult {
  instanceName: string;
  status: 'done' | 'failed';
  /** The updater's own message (scripts/update.sh, in English). */
  message: string | null;
  systemUrl: string;
}

/** Phase 54: the approved update finished: installed, or not and why. */
export function updateResultEmail(r: UpdateResult): {
  subject: string;
  text: string;
  html: string;
} {
  const name = oneLine(r.instanceName);
  const ok = r.status === 'done';
  const detail = r.message ? oneLine(r.message).slice(0, 500) : null;
  const he = {
    lead: ok ? `העדכון של ${name} הותקן.` : `העדכון של ${name} לא הותקן.`,
    what: ok ? 'הגרסה החדשה פועלת.' : 'האתר ממשיך לפעול בגרסה הקודמת.',
    reported: 'מה השרת דיווח (באנגלית):',
    page: 'מצב המערכת בלוח הניהול:',
    footer: 'המייל נשלח למנהלי הקהילה פעם אחת לכל עדכון שאושר.',
  };
  const en = {
    lead: ok ? `The update of ${name} is installed.` : `The update of ${name} wasn’t installed.`,
    what: ok ? 'The new version is running.' : 'The site keeps running the previous version.',
    reported: 'What the server reported:',
    page: 'System status in the dashboard:',
    footer: 'This email goes to the community’s admins once for each approved update.',
  };
  const subject = ok
    ? `${name}: העדכון הותקן · Update installed`
    : `⚠️ ${name}: העדכון לא הותקן · Update not installed`;
  const textBlock = (t: typeof en) => [
    t.lead,
    t.what,
    ...(detail ? [t.reported, `  ${detail}`] : []),
    `${t.page} ${r.systemUrl}`,
    t.footer,
  ];
  const text = [...textBlock(he), '', '---', '', ...textBlock(en), '', creditLine('en')].join('\n');
  const block = (t: typeof en, dir: 'rtl' | 'ltr', lang: string) =>
    `<div dir="${dir}" lang="${lang}">` +
    `<p><strong>${withName(t.lead, name)}</strong></p><p>${escapeHtml(t.what)}</p>` +
    (detail
      ? `<p>${escapeHtml(t.reported)}</p>` +
        `<blockquote dir="ltr" lang="en">${escapeHtml(detail)}</blockquote>`
      : '') +
    `<p>${escapeHtml(t.page)} <a href="${escapeHtml(r.systemUrl)}" dir="ltr">` +
    `${escapeHtml(r.systemUrl)}</a></p>` +
    `<p style="color:#555;font-size:13px">${escapeHtml(t.footer)}</p></div>`;
  const html =
    `<div style="font-family:sans-serif;line-height:1.5">` +
    block(he, 'rtl', 'he') +
    '<hr>' +
    block(en, 'ltr', 'en') +
    `${creditHtml('en')}</div>`;
  return { subject, text, html };
}
