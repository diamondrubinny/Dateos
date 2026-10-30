// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 63 end to end: an admin requires an age check (Dashboard → Branding → Who may join); a
 * member is asked in the app, goes to the provider (here the pretend one, fake-age-provider.mjs),
 * comes back and carries on; another member's "under 18" suspends the account.
 * Usage: pnpm --dir e2e age-check (API started with AGE_CHECK_URL/SECRET, fake provider running)
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

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = { en: ['Mira', 'Tom'], he: ['מירה', 'תום'] };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession(tag: string) {
  const email = `age-admin-${tag}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

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

await resetSignInLimits();
await pool.query(
  'INSERT INTO instance_settings (id, setup_completed_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET setup_completed_at = COALESCE(instance_settings.setup_completed_at, now())',
);
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale];
    const [herName, hisName] = NAMES[locale];

    // ------------------------------------------------------------ admin: require it
    const boss = await adminSession(locale);
    await boss.call('PATCH', '/v1/admin/instance', { ageCheckRequired: false });
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/branding`);
      const join = S.page.locator('form', {
        has: S.page.getByRole('heading', { name: a.branding.joinTitle }),
      });
      await join.waitFor();
      await join.getByLabel(a.branding.ageCheck).check();
      await join.getByRole('button', { name: a.branding.joinSave }).click();
      await S.page.getByText(a.branding.joinSaved).waitFor();
      await join.getByLabel(a.branding.ageCheck).scrollIntoViewIfNeeded();
      await audit(S.page, `${locale}/admin-age-check`);
      await shot(S.page, `${locale}/admin-34-age-check`);
      const info = (await (
        await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/v1/instance`)
      ).json()) as { community: { ageCheck: boolean } };
      check(info.community.ageCheck, 'the admin requires an age check');
    } finally {
      await S.context.close();
    }

    // ------------------------------------------------------------ a member: over 18
    const mira = await onboardMember(`age-${locale}`, herName, 'woman', ['man']);
    const M = await open(browser, locale, mira.session);
    try {
      await M.page.goto(`${WEB}/`);
      await M.page.waitForURL((url) => url.pathname === '/onboarding/age-check', {
        timeout: 20_000,
      });
      await M.page.getByText(t.ageCheck.kept).waitFor();
      check(true, 'the app asks first, and says only the result is kept');
      await audit(M.page, `${locale}/age-check`);
      await shot(M.page, `${locale}/148-age-check`);
      await M.page.getByRole('button', { name: t.ageCheck.start }).click();
      await M.page.waitForURL((url) => url.port === '8090', { timeout: 20_000 });
      check(true, 'the member is sent to the provider');
      await M.page.getByRole('button', { name: 'Over 18' }).click();
      await M.page.waitForURL((url) => url.pathname === '/discover', { timeout: 30_000 });
      check(true, 'back from the provider, the app carries on by itself');
      const { rows } = await pool.query(
        'SELECT result, method FROM age_checks WHERE user_id = $1',
        [mira.id],
      );
      check(
        rows[0]?.result === 'over_18' && rows[0]?.method === 'pretend',
        'only the result is stored',
      );
    } finally {
      await M.context.close();
    }

    // ------------------------------------------------------------ another member: under 18
    const tom = await onboardMember(`age-${locale}`, hisName, 'man', ['woman']);
    const T2 = await open(browser, locale, tom.session);
    try {
      await T2.page.goto(`${WEB}/onboarding/age-check`);
      await T2.page.getByRole('button', { name: t.ageCheck.start }).click();
      await T2.page.waitForURL((url) => url.port === '8090', { timeout: 20_000 });
      await T2.page.getByRole('button', { name: 'Under 18' }).click();
      let status = '';
      for (let i = 0; i < 40 && status !== 'suspended'; i += 1) {
        const { rows } = await pool.query('SELECT status FROM "user" WHERE id = $1', [tom.id]);
        status = rows[0]?.status ?? '';
        if (status !== 'suspended') await T2.page.waitForTimeout(250);
      }
      check(status === 'suspended', 'a result of under 18 suspends the account');
    } finally {
      await T2.context.close();
    }
    await boss.call('PATCH', '/v1/admin/instance', { ageCheckRequired: false });
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
process.stdout.write('\nAge checks: OK\n');
