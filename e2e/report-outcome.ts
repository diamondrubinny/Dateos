// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 37 end to end: after a moderator decides, the member who reported sees "Your report was
 * reviewed" (whether something was done, never what), and "OK" dismisses it.
 * Usage: pnpm --dir e2e report-outcome
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
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
const NAMES: Record<L, [string, string]> = { en: ['Maya', 'Dan'], he: ['מאיה', 'דן'] };

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
    const [herName, hisName] = NAMES[locale];
    const maya = await onboardMember(`outcome-${locale}`, herName, 'woman', ['man']);
    const dan = await onboardMember(`outcome-${locale}`, hisName, 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    const { reportId } = await maya.call<{ reportId: string }>('POST', '/v1/reports', {
      targetId: dan.id,
      category: 'harassment',
      block: false,
    });
    // A moderator's decision (the dashboard flow itself is covered by the safety e2e).
    await pool.query(
      `UPDATE reports SET status = 'actioned', resolved_action = 'warn', resolved_at = now(),
         resolved_reason = 'e2e' WHERE id = $1`,
      [reportId],
    );

    const A = await open(browser, locale, maya);
    try {
      await A.page.goto(`${WEB}/discover`);
      const card = A.page.getByTestId('report-reviewed');
      await card.waitFor();
      const text = await card.innerText();
      check(text.includes(t.account.reviewedTitle), '"Your report was reviewed" is shown');
      check(text.includes(t.account.reviewedActioned), 'it says action was taken');
      check(!text.includes(hisName), 'it doesn’t name the reported person');
      await audit(A.page, `${locale}/report-reviewed`);
      await shot(A.page, `${locale}/109-report-reviewed`);
      await card.getByRole('button', { name: t.account.reviewedOk }).click();
      await card.waitFor({ state: 'detached' });
      check(true, 'OK dismisses it');
      const me = await maya.call<{ notices: unknown[] }>('GET', '/v1/me');
      check(me.notices.length === 0, 'and it stays dismissed');
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
process.stdout.write('\nReport outcome: OK\n');
