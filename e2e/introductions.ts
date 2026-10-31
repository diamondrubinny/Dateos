// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 68a end to end: an admin names a community matchmaker and chooses "women first"; a member
 * opts in from Settings; the matchmaker introduces her to a man from the console; she hears first
 * and says yes; he says yes; a chat opens; he tells the matchmaker they met; the report counts it.
 * Usage: pnpm --dir e2e introductions (API, worker, web app and dashboard running)
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
  apiClient,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const T = { en, he } as const;
type L = keyof typeof T;
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const NAMES: Record<L, [string, string, string]> = {
  en: ['Rina', 'Noa', 'Dan'],
  he: ['רינה', 'נועה', 'דן'],
};
const NOTE: Record<L, string> = {
  en: 'You both volunteer on Fridays and love old films.',
  he: 'אהבה משותפת לסרטים ישנים והתנדבות בימי שישי.',
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  desktop = false,
) {
  const context = await browser.newContext({
    viewport: desktop ? { width: 1280, height: 1000 } : { width: 390, height: 844 },
    deviceScaleFactor: desktop ? 1 : 2,
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

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession() {
  const email = `intro-admin-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

type Received = {
  received: { id: string; state: string; myAnswer: string | null; outcome: string | null }[];
};

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const boss = await adminSession();
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale].matchmakers;
    const [rinaName, noaName, danName] = NAMES[locale];
    // Earlier runs' members stay out of this console.
    await pool.query('UPDATE preferences SET open_to_matchmakers = false');
    await pool.query('DELETE FROM matchmakers');
    const rina = await onboardMember(`intro-${locale}`, rinaName, 'woman', ['man']);
    const noa = await onboardMember(`intro-${locale}`, noaName, 'woman', ['man']);
    const dan = await onboardMember(`intro-${locale}`, danName, 'man', ['woman']);
    await dan.call('PUT', '/v1/me/settings', { openToMatchmakers: true });

    // ---------------------------------------------------------- the dashboard
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/matchmakers`);
      const email = S.page.getByLabel(a.email);
      await email.waitFor({ timeout: 20_000 });
      await email.fill(rina.email);
      await S.page.getByRole('button', { name: a.grant, exact: true }).click();
      await S.page.getByText(a.granted).waitFor();
      await S.page.getByRole('radio', { name: a.orders.women_first }).check();
      await S.page.getByRole('button', { name: a.save, exact: true }).click();
      await S.page.getByText(a.saved).waitFor();
      await S.page.getByRole('row', { name: new RegExp(rinaName) }).waitFor();
      check(true, 'an admin names a matchmaker and chooses "women first"');
      await audit(S.page, `${locale}/admin-matchmakers`);
      await shot(S.page, `${locale}/admin-38-matchmakers`);
    } finally {
      await S.context.close();
    }

    // ---------------------------------------------------------- Noa opts in from Settings
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/settings`);
      const box = N.page.getByRole('checkbox', { name: t.intro.openLabel });
      await box.waitFor({ timeout: 20_000 });
      await box.click();
      let on = false;
      for (let i = 0; i < 40 && !on; i += 1) {
        on = (await noa.call<{ openToMatchmakers: boolean }>('GET', '/v1/me/settings'))
          .openToMatchmakers;
        if (!on) await N.page.waitForTimeout(250);
      }
      check(on, 'the member turns on "Open to matchmakers"');
    } finally {
      await N.context.close();
    }

    // ---------------------------------------------------------- Rina's console
    const R = await open(browser, locale, rina.session);
    try {
      await R.page.goto(`${WEB}/matchmaking`);
      const rows = R.page.getByTestId('console-member');
      await rows.first().waitFor({ timeout: 20_000 });
      check((await rows.count()) === 2, 'the console lists only members open to matchmakers');
      for (const name of [noaName, danName]) {
        await R.page.getByRole('checkbox', { name: fill(t.console.choose, { name }) }).click();
      }
      await R.page.getByLabel(t.console.note).fill(NOTE[locale]);
      await R.page.getByTestId('console-compose').scrollIntoViewIfNeeded();
      await audit(R.page, `${locale}/matchmaker-console`);
      await shot(R.page, `${locale}/162-matchmaker-console`);
      await R.page.getByRole('button', { name: t.console.send }).click();
      await R.page.getByText(t.console.sent).waitFor();
      check(true, 'the matchmaker introduces the two from the console');
    } finally {
      await R.context.close();
    }
    check(
      (await dan.call<Received>('GET', '/v1/me/introductions')).received.length === 0,
      'women first: he has nothing yet',
    );

    // ---------------------------------------------------------- Noa hears first, says yes
    const N2 = await open(browser, locale, noa.session);
    try {
      await N2.page.goto(`${WEB}/matches`);
      await N2.page.getByTestId('introductions-entry').click();
      const card = N2.page.getByTestId('introduction');
      await card.waitFor({ timeout: 20_000 });
      check(
        (await card.innerText()).includes(NOTE[locale]) &&
          (await card.innerText()).includes(
            fill(t.intro.cardTitle, { by: rinaName, name: danName }),
          ),
        'she sees who suggested it, why, and with whom',
      );
      await audit(N2.page, `${locale}/introduction`);
      await shot(N2.page, `${locale}/163-introduction`);
      await card.getByRole('button', { name: t.intro.yes }).click();
      await N2.page.getByText(fill(t.intro.saidYes, { name: danName })).waitFor();
      check(true, 'she says yes');
    } finally {
      await N2.context.close();
    }

    // ---------------------------------------------------------- Dan says yes: a chat opens
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/introductions`);
      const card = D.page.getByTestId('introduction');
      await card.waitFor({ timeout: 20_000 });
      await card.getByRole('button', { name: t.intro.yes }).click();
      await D.page.getByText(fill(t.intro.matched, { name: noaName })).waitFor();
      await card.getByRole('radio', { name: t.intro.outcome.met }).click();
      let outcome: string | null = null;
      for (let i = 0; i < 40 && !outcome; i += 1) {
        outcome = (await dan.call<Received>('GET', '/v1/me/introductions')).received[0]!.outcome;
        if (!outcome) await D.page.waitForTimeout(250);
      }
      check(outcome === 'met', 'two yeses open a chat; he tells the matchmaker they met');
      await audit(D.page, `${locale}/introduction-matched`);
      await shot(D.page, `${locale}/164-introduction-matched`);
      await card.getByRole('button', { name: fill(t.intro.openChat, { name: noaName }) }).click();
      await D.page.waitForURL(/\/chat\//);
      check(true, 'the chat opens');
    } finally {
      await D.context.close();
    }

    const report = await boss.call<{
      matchmakers: { displayName: string; introductions: number; matches: number; met: number }[];
    }>('GET', '/v1/admin/matchmakers');
    const row = report.matchmakers.find((r) => r.displayName === rinaName);
    check(
      row?.introductions === 1 && row.matches === 1 && row.met === 1,
      'the report credits the matchmaker',
    );
  }
} finally {
  await boss.call('PATCH', '/v1/admin/instance', { introductionOrder: 'together' }).catch(() => {});
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nCommunity matchmakers: OK\n');
