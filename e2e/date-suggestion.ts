// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 75a end to end: two people who matched share when they're free; the chat suggests a time
 * and a place; "Plan it" opens the planner with both filled in. An admin sets the time to answer
 * introductions in the dashboard.
 * Usage: pnpm --dir e2e date-suggestion
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
const PLACES: Record<'en' | 'he', { cafe: string; bar: string; area: string }> = {
  en: { cafe: 'Café Puaa', bar: 'Night Bar', area: 'Jaffa' },
  he: { cafe: 'קפה פועה', bar: 'בר הלילה', area: 'יפו' },
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
/** A day from today, as the free-times slots name it. */
const dayFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function adminSession() {
  const email = `suggest75-admin-${Date.now()}@example.test`;
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
    const a = adminMessages[locale as 'en' | 'he'].matchmakers;
    const p = PLACES[locale as 'en' | 'he'];
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM events');
    await pool.query('DELETE FROM venues');
    await resetRouteLimits();
    const admin = await adminSession();
    for (const [name, category] of [
      [p.bar, 'bar'],
      [p.cafe, 'cafe'],
    ] as const) {
      await admin.call('POST', '/v1/admin/venues', {
        name,
        area: p.area,
        category,
        address: 'Rabbi Yohanan St 8',
      });
    }

    // 1. Two people share when they're free (Tuesday-to-Thursday-ish: days 2 and 3 from now).
    const noa = await onboardMember(`suggest75-${locale}`, 'Noa', 'woman', ['man']);
    const dan = await onboardMember(`suggest75-${locale}`, 'Dan', 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    const day = dayFromNow(3);
    await noa.call('PUT', `/v1/matches/${matchId}/availability`, {
      slots: [`${day}:evening`, `${dayFromNow(4)}:morning`],
    });
    await dan.call('PUT', `/v1/matches/${matchId}/availability`, { slots: [`${day}:evening`] });

    // 2. The chat suggests a time and a place; "Plan it" fills the planner.
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/chat/${matchId}`);
      const suggestion = N.page.getByTestId('date-suggestion');
      await suggestion.waitFor();
      check(
        (await suggestion.innerText()).includes(p.cafe),
        'the chat suggests the shared evening, at the café (before the bar)',
      );
      await audit(N.page, `${locale}/date-suggestion`);
      await shot(N.page, `${locale}/192-date-suggestion`);
      await N.page.getByRole('button', { name: t.free.planIt, exact: true }).click();
      await N.page.waitForURL((url) => url.pathname.startsWith('/date/'));
      const cafe = N.page.getByRole('radio', { name: new RegExp(p.cafe) });
      await cafe.waitFor();
      check((await cafe.getAttribute('aria-checked')) === 'true', 'the planner has the place');
      check(
        (await N.page.getByRole('radio', { checked: true, name: /19/ }).count()) > 0,
        'and the evening time',
      );
    } finally {
      await N.context.close();
    }

    // 3. The dashboard: the time to answer an introduction.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/matchmakers`);
      const select = S.page.getByLabel(a.windowLabel);
      await select.waitFor();
      await select.selectOption('24');
      await S.page.getByRole('button', { name: a.save, exact: true }).first().click();
      await S.page.getByText(a.saved).first().waitFor();
      const settings = await admin.call<{ introductionHours: number }>('GET', '/v1/admin/instance');
      check(settings.introductionHours === 24, 'the community gives 24 hours to answer');
      await audit(S.page, `${locale}/admin-introduction-window`);
      await select.scrollIntoViewIfNeeded();
      await shot(S.page, `${locale}/admin-18-introduction-window`);
      await admin.call('PATCH', '/v1/admin/instance', { introductionHours: 336 });
    } finally {
      await S.context.close();
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
process.stdout.write('\nDate suggestion: OK\n');
