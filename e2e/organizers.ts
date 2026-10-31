// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 71e end to end: an admin makes a member a community organizer in the dashboard; the
 * organizer proposes an event in the app; the admin approves it; another member sees "Organized
 * by"; the organizer posts an update from the app.
 * Usage: pnpm --dir e2e organizers
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  apiClient,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetRouteLimits,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const DATA: Record<'en' | 'he', { her: string; him: string; title: string; update: string }> = {
  en: { her: 'Noa', him: 'Dan', title: 'Sunset picnic', update: 'Bring a blanket!' },
  he: { her: 'נועה', him: 'דן', title: 'פיקניק בשקיעה', update: 'כדאי להביא שמיכה!' },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''));

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession() {
  const email = `organizers-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale as 'en' | 'he'];
    const d = DATA[locale as 'en' | 'he'];
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM events');
    await pool.query('DELETE FROM event_proposals');
    await pool.query('DELETE FROM event_organizers');
    await pool.query('DELETE FROM venues');
    await resetRouteLimits();
    const admin = await adminSession();
    await admin.call('POST', '/v1/admin/venues', {
      name: 'HaYarkon Park',
      area: 'Tel Aviv',
      category: 'park',
      address: 'Rokach Blvd',
    });
    const noa = await onboardMember(`organizers-${locale}`, d.her, 'woman', ['man']);
    const dan = await onboardMember(`organizers-${locale}`, d.him, 'man', ['woman']);

    // 1. The admin makes Noa an organizer in the dashboard.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/events`);
      await S.page.getByLabel(a.organizers.email).fill(noa.email);
      await S.page.getByRole('button', { name: a.organizers.grant }).click();
      await S.page.getByText(a.organizers.granted).waitFor();
      check(true, 'the admin made her an organizer');
    } finally {
      await S.context.close();
    }

    // 2. Noa proposes an event in the app.
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/events`);
      await N.page.getByRole('button', { name: t.organize.open }).click();
      await N.page.waitForURL((url) => url.pathname.startsWith('/organize'));
      await N.page.getByLabel(t.organize.name, { exact: true }).fill(d.title);
      await N.page.getByRole('radio', { name: 'HaYarkon Park, Tel Aviv' }).click();
      await N.page.getByRole('button', { name: t.organize.send }).click();
      await N.page.getByText(t.organize.sent).waitFor();
      await N.page.getByText(t.organize.status.pending).waitFor();
      check(true, 'proposed; waiting for an admin');
      await audit(N.page, `${locale}/organize`);
      await shot(N.page, `${locale}/185-organize`);
    } finally {
      await N.context.close();
    }

    // 3. The admin approves it in the dashboard.
    const S2 = await open(browser, locale, admin.session, 1280);
    try {
      await S2.page.goto(`${ADMIN}/#/events`);
      const proposal = S2.page.getByTestId('proposal').first();
      await proposal.waitFor();
      check((await proposal.innerText()).includes(d.title), 'the proposal waits in the dashboard');
      await audit(S2.page, `${locale}/admin-organizers`);
      await S2.page.locator('#organizers-title').scrollIntoViewIfNeeded();
      await shot(S2.page, `${locale}/admin-12-organizers`);
      await proposal.getByRole('button', { name: new RegExp(a.organizers.approve) }).click();
      await S2.page.getByText(fill(a.organizers.approved, { title: d.title })).waitFor();
      check(true, 'approved and published');
    } finally {
      await S2.context.close();
    }
    const { rows } = await pool.query(`SELECT id FROM events WHERE title = $1`, [d.title]);
    const eventId = rows[0].id as string;

    // 4. Dan sees who organizes it.
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/events/${eventId}`);
      const by = D.page.getByTestId('event-organizer');
      await by.waitFor();
      check(
        (await by.innerText()).includes(fill(t.organize.by, { name: d.her })),
        '“Organized by” on the event',
      );
      await audit(D.page, `${locale}/organized-by`);
      await shot(D.page, `${locale}/186-organized-by`);
    } finally {
      await D.context.close();
    }

    // 5. Noa runs it: an update to everyone going.
    const R = await open(browser, locale, noa.session);
    try {
      await R.page.goto(`${WEB}/organize/${eventId}`);
      await R.page.getByLabel(t.organize.update).fill(d.update);
      await R.page.getByRole('button', { name: t.organize.post }).click();
      await R.page.getByText(t.organize.posted).waitFor();
      await R.page.getByRole('button', { name: t.organize.showCode }).click();
      await R.page.getByTestId('organizer-code').waitFor();
      check(true, 'the organizer posted an update and showed the check-in code');
      await audit(R.page, `${locale}/organize-run`);
    } finally {
      await R.context.close();
    }
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nCommunity organizers: OK\n');
