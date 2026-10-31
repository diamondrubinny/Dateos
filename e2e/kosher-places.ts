// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 74b end to end: an admin marks a place kosher and closed on Shabbat in the dashboard; in
 * the date planner a member sees the tags, keeps to kosher places only, and the date card shows
 * them.
 * Usage: pnpm --dir e2e kosher-places
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
const PLACES: Record<'en' | 'he', { kosher: string; other: string; area: string }> = {
  en: { kosher: 'Café Shalom', other: 'Night Bar', area: 'Jerusalem' },
  he: { kosher: 'קפה שלום', other: 'בר הלילה', area: 'ירושלים' },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

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
  const email = `kosher74-admin-${Date.now()}@example.test`;
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
    const p = PLACES[locale as 'en' | 'he'];
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM events');
    await pool.query('DELETE FROM venues');
    await resetRouteLimits();
    const admin = await adminSession();
    await admin.call('POST', '/v1/admin/venues', {
      name: p.other,
      area: p.area,
      category: 'bar',
      address: 'Jaffa Rd 1',
    });

    // 1. The admin marks a place kosher and closed on Shabbat.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/venues`);
      await S.page.getByLabel(a.venues.name, { exact: true }).fill(p.kosher);
      await S.page.getByLabel(a.venues.area).fill(p.area);
      await S.page.getByLabel(a.venues.category).selectOption('cafe');
      await S.page.getByLabel(a.venues.address).fill('King George St 10');
      await S.page.getByLabel(a.venues.kosherLabel).check();
      await S.page.getByLabel(a.venues.shabbatClosedLabel).check();
      await S.page.getByRole('button', { name: a.venues.add }).click();
      await S.page.getByText(a.venues.added.replace('{{name}}', p.kosher)).waitFor();
      await S.page.getByText(a.venues.kosher, { exact: true }).first().waitFor();
      check(true, 'the admin marked the place kosher and closed on Shabbat');
      await audit(S.page, `${locale}/admin-kosher-venue`);
      await shot(S.page, `${locale}/admin-17-kosher-venue`);
    } finally {
      await S.context.close();
    }

    // 2. A member plans a date: the tags, and kosher places only.
    const noa = await onboardMember(`kosher74-${locale}`, 'Noa', 'woman', ['man']);
    const dan = await onboardMember(`kosher74-${locale}`, 'Dan', 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/date/${matchId}?name=Dan`);
      const kosher = N.page.getByRole('radio', { name: new RegExp(p.kosher) });
      await kosher.waitFor();
      const label = (await kosher.getAttribute('aria-label')) ?? (await kosher.innerText());
      check(
        label.includes(t.datePlan.kosher) && label.includes(t.datePlan.shabbatClosed),
        'the planner shows “kosher” and “closed on Shabbat”',
      );
      check(
        (await N.page.getByRole('radio', { name: new RegExp(p.other) }).count()) === 1,
        'other places too, at first',
      );
      await N.page.getByRole('checkbox', { name: t.datePlan.kosherOnly }).click();
      await N.page.getByRole('radio', { name: new RegExp(p.other) }).waitFor({ state: 'detached' });
      check(true, '“Kosher places only” leaves the other place out');
      await audit(N.page, `${locale}/date-kosher`);
      await shot(N.page, `${locale}/191-date-kosher`);
      await kosher.click();
      await N.page.getByRole('button', { name: t.datePlan.send }).click();
      // The planner goes back to where it was opened from; the chat has the card.
      const sent = async () =>
        (
          await noa.call<{ messages: { kind: string }[] }>('GET', `/v1/matches/${matchId}/messages`)
        ).messages.some((m) => m.kind === 'date');
      for (let i = 0; i < 20 && !(await sent()); i += 1) await N.page.waitForTimeout(250);
      await N.page.goto(`${WEB}/chat/${matchId}`);
      await N.page.getByText(t.datePlan.shabbatClosed, { exact: false }).first().waitFor();
      check(true, 'the date card in the chat shows the tags');
    } finally {
      await N.context.close();
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
process.stdout.write('\nKosher places: OK\n');
