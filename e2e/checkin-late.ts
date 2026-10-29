// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 45 end to end: a date running long. The member moves the check-in time later from the
 * check-in screen, nothing is emailed, and after the last extension the screen says so.
 * Usage: pnpm --dir e2e checkin-late
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { CHECKIN_EXTENSIONS } from '@nexaheart/shared';
import { chromium, type Browser } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
  audit,
  LOCALE_TAGS,
  locales,
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

/** Waits until the server recorded this many extensions (each tap is one request). */
async function extensionsReach(id: string, n: number) {
  for (let tries = 0; tries < 50; tries++) {
    const { rows } = await pool.query('SELECT extensions FROM checkins WHERE id = $1', [id]);
    if (rows[0]?.extensions >= n) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`extensions never reached ${n}`);
}

const contact = `late-contact-${Date.now()}@example.test`;
await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const maya = await onboardMember(`late-${locale}`, locale === 'he' ? 'מאיה' : 'Maya', 'woman', [
      'man',
    ]);
    const now = Date.now();
    const { id } = await maya.call<{ id: string }>('POST', '/v1/me/checkins', {
      place: locale === 'he' ? 'קפה פועה, יפו' : 'Café Puaa, Jaffa',
      startsAt: new Date(now).toISOString(),
      checkAt: new Date(now + 2 * 3_600_000).toISOString(),
      contactName: 'Dana',
      contactEmail: contact,
      locale,
      timeZone: 'Asia/Jerusalem',
    });
    const before = (await pool.query('SELECT check_at FROM checkins WHERE id = $1', [id])).rows[0]
      .check_at as Date;
    const A = await open(browser, locale, maya);
    try {
      await A.page.goto(`${WEB}/checkin`);
      const late = A.page.getByTestId('checkin-late');
      await late.waitFor();
      await late.getByRole('button', { name: t.checkin.late60 }).click();
      await A.page.getByText(t.checkin.lateDone.split('{{')[0]!.trim()).waitFor();
      const after = (await pool.query('SELECT check_at FROM checkins WHERE id = $1', [id])).rows[0]
        .check_at as Date;
      check(after.getTime() - before.getTime() === 3_600_000, 'the check-in time moved an hour');
      // The contact's (masked) address stays one piece in either direction.
      const body = await A.page.locator('body').innerText();
      check(body.includes('⁦'), 'the contact’s address is isolated in the sentence');
      await audit(A.page, `${locale}/checkin-late`);
      await shot(A.page, `${locale}/119-checkin-late`);

      for (let i = 1; i < CHECKIN_EXTENSIONS; i++) {
        await late.getByRole('button', { name: t.checkin.late30 }).click();
        await extensionsReach(id, i + 1);
      }
      await late.getByText(t.checkin.lateNone).waitFor();
      check(true, 'after the last extension, the screen says so');
      const { rows } = await pool.query('SELECT extensions, status FROM checkins WHERE id = $1', [
        id,
      ]);
      check(
        rows[0].extensions === CHECKIN_EXTENSIONS && rows[0].status === 'active',
        'all extensions used, still active',
      );
      await audit(A.page, `${locale}/checkin-late-none`);
      await A.page.getByRole('button', { name: t.checkin.ok }).click();
      await A.page.getByText(t.checkin.okDone).waitFor();
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
process.stdout.write('\nRunning late: OK\n');
