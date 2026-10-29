// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 46 end to end: Dan answers Maya's date idea with "Suggest another time" (same place, a
 * new day); Maya sees her idea marked as answered and accepts his time.
 * Usage: pnpm --dir e2e date-counter
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
    const [her, him] = NAMES[locale];
    const maya = await onboardMember(`counter-${locale}`, her, 'woman', ['man']);
    const dan = await onboardMember(`counter-${locale}`, him, 'man', ['woman']);
    const venueName = `Café Puaa ${locale} ${Date.now() % 100000}`;
    const { rows: venue } = await pool.query<{ id: string }>(
      `INSERT INTO venues (name, area, category, address, step_free)
       VALUES ($1, 'Jaffa', 'cafe', 'Rabbi Yohanan St 8', true) RETURNING id`,
      [venueName],
    );
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    const { matchId } = await maya.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    // Maya's idea: tomorrow evening.
    const startsAt = new Date(Date.now() + 86_400_000);
    startsAt.setHours(19, 0, 0, 0);
    const proposed = await maya.call<{ date: { id: string } }>(
      'POST',
      `/v1/matches/${matchId}/dates`,
      { venueId: venue[0]!.id, startsAt: startsAt.toISOString(), clientId: `ctr-${Date.now()}` },
    );

    const D = await open(browser, locale, dan);
    const M = await open(browser, locale, maya);
    try {
      // 1. Dan suggests another day at the same place.
      await D.page.goto(`${WEB}/chat/${matchId}`);
      await D.page.getByRole('button', { name: t.datePlan.otherTime }).click();
      await D.page.waitForURL((url) => url.pathname === `/date/${matchId}`);
      await D.page.getByText(t.datePlan.samePlace, { exact: true }).waitFor();
      check(
        (await D.page.getByRole('radiogroup', { name: t.datePlan.place }).count()) === 0,
        'no place to choose: it stays the same',
      );
      // The same time is refused on the device.
      await D.page.getByRole('button', { name: t.datePlan.counterSend }).click();
      await D.page.getByText(t.datePlan.sameTime).waitFor();
      check(true, 'the same time is refused');
      await D.page.getByRole('radio', { name: ':30', exact: true }).click();
      await audit(D.page, `${locale}/date-counter`);
      await shot(D.page, `${locale}/120-date-counter`);
      await D.page.getByRole('button', { name: t.datePlan.counterSend }).click();
      await D.page.waitForURL((url) => url.pathname === `/chat/${matchId}`);

      const { rows } = await pool.query(
        `SELECT id, status, countered, starts_at, venue_name FROM date_plans
         WHERE match_id = $1 ORDER BY created_at`,
        [matchId],
      );
      check(
        rows.length === 2 && rows[0].status === 'declined' && rows[0].countered,
        'her idea is declined as countered',
      );
      check(
        rows[1].status === 'proposed' &&
          rows[1].venue_name === venueName &&
          new Date(rows[1].starts_at).getTime() - startsAt.getTime() === 30 * 60_000,
        'his idea: same place, half an hour later',
      );

      // 2. Maya sees the answer and accepts it.
      await M.page.goto(`${WEB}/chat/${matchId}`);
      await M.page.getByText(t.datePlan.countered, { exact: false }).first().waitFor();
      await M.page.getByRole('button', { name: t.datePlan.accept, exact: true }).click();
      await M.page.getByText(t.datePlan.accepted).waitFor();
      check(true, 'she accepts his time');
      await audit(M.page, `${locale}/date-countered`);
      await shot(M.page, `${locale}/121-date-countered`);
      check(proposed.date.id === rows[0].id, 'the first card is her original idea');
    } finally {
      await D.context.close();
      await M.context.close();
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
process.stdout.write('\nSuggest another time: OK\n');
