// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 43 end to end: deleting the account from an old session asks for a fresh sign-in; the
 * link (real mail through Mailpit) signs in again, and then the deletion goes through.
 * Usage: pnpm --dir e2e reauth
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { RECENT_SIGN_IN_MINUTES } from '@nexaheart/shared';
import { chromium, type Browser } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
  audit,
  LOCALE_TAGS,
  locales,
  magicLink,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const T = { en, he } as const;
type L = keyof typeof T;

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function open(browser: Browser, locale: L, member: OnboardedMember) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  const { name, value } = member.session;
  await context.addCookies([
    { name, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const maya = await onboardMember(
      `reauth-${locale}`,
      locale === 'he' ? 'מאיה' : 'Maya',
      'woman',
      ['man'],
    );
    // Her session signed in a while ago (an unlocked phone, say).
    await pool.query(
      `UPDATE session SET created_at = now() - make_interval(mins => $2) WHERE user_id = $1`,
      [maya.id, RECENT_SIGN_IN_MINUTES + 10],
    );
    const A = await open(browser, locale, maya);
    try {
      await A.page.goto(`${WEB}/settings`);
      await A.page.getByRole('button', { name: t.settings.deleteAccount }).click();
      await A.page.getByRole('button', { name: t.settings.deleteConfirm }).click();
      const notice = A.page.getByTestId('reauth-notice');
      await notice.waitFor();
      check(true, 'an old session is asked to sign in again');
      const still = await pool.query('SELECT 1 FROM "user" WHERE id = $1', [maya.id]);
      check(still.rows.length === 1, 'the account is still there');
      await notice.getByRole('button', { name: t.reauth.send }).click();
      await notice.getByText(t.reauth.sent.split('{{')[0]!.trim()).waitFor();
      await audit(A.page, `${locale}/reauth`);
      await notice.scrollIntoViewIfNeeded();
      await shot(A.page, `${locale}/116-reauth`);

      // The link signs her in again on this device; then deleting works.
      await A.page.goto(await magicLink(maya.email));
      await A.page.waitForURL((url) => !url.pathname.startsWith('/auth'));
      await A.page.goto(`${WEB}/settings`);
      await A.page.getByRole('button', { name: t.settings.deleteAccount }).click();
      await A.page.getByRole('button', { name: t.settings.deleteConfirm }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/welcome'));
      const gone = await pool.query('SELECT 1 FROM "user" WHERE id = $1', [maya.id]);
      check(gone.rows.length === 0, 'after a fresh sign-in, the account is deleted');
    } finally {
      await A.context.close();
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
process.stdout.write('\nRecent sign-in: OK\n');
