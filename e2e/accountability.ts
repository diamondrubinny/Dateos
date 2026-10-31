// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 70 end to end: a member with five matches waiting over 3 days for a reply opens
 * Profile → "My visibility", sees why new people see them less and what lifts it, replies once,
 * and sees "You're visible".
 * Usage: pnpm --dir e2e accountability
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { UNANSWERED_LIMIT } from '@nexaheart/shared';
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
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

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, { him: string; them: string[] }> = {
  en: { him: 'Dan', them: ['Maya', 'Noa', 'Tal', 'Shira', 'Yael'] },
  he: { him: 'דן', them: ['מאיה', 'נועה', 'טל', 'שירה', 'יעל'] },
  ar: { him: 'سامي', them: ['ليلى', 'نور', 'هدى', 'سلمى', 'ريم'] },
  ru: { him: 'Дима', them: ['Маша', 'Аня', 'Оля', 'Катя', 'Лена'] },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''));

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

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
let sent = 0;
await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const names = NAMES[locale];
    const dan = await onboardMember(`accountability-${locale}`, names.him, 'man', ['woman']);
    // Five women he matched with, each wrote to him four days ago and is still waiting.
    const matches: string[] = [];
    for (const name of names.them.slice(0, UNANSWERED_LIMIT)) {
      const w = await onboardMember(`accountability-${locale}`, name, 'woman', ['man']);
      await w.call('POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
      const { matchId } = await dan.call<{ matchId: string }>('POST', '/v1/interactions', {
        targetId: w.id,
        kind: 'like',
      });
      await w.call('POST', `/v1/matches/${matchId}/messages`, {
        clientId: `msg-acc-${(sent += 1)}-e2e`,
        text: `Hi ${names.him}!`,
      });
      await pool.query(
        `UPDATE messages SET created_at = now() - interval '4 days' WHERE match_id = $1`,
        [matchId],
      );
      matches.push(matchId);
    }
    const A = await open(browser, locale, dan);
    try {
      // 1. Profile → My visibility: listed with the number waiting and what lifts it.
      await A.page.goto(`${WEB}/profile`);
      await A.page.getByRole('button', { name: t.myVisibility.open, exact: true }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/visibility'));
      const item = A.page.getByTestId('vis-unanswered');
      await item.waitFor();
      const text = await item.innerText();
      check(
        text.includes(fill(t.myVisibility.item.unanswered, { count: UNANSWERED_LIMIT })),
        'it says how many are waiting and what lifts it',
      );
      check(
        (await A.page.getByText(t.myVisibility.fewerTitle).count()) === 1,
        'listed under "Fewer people see you", not hidden',
      );
      check((await A.page.getByTestId('vis-visible').count()) === 0, 'not "You’re visible"');
      await audit(A.page, `${locale}/my-visibility`);
      await shot(A.page, `${locale}/175-my-visibility`);

      // 2. "Open my chats" goes to the matches.
      await item.getByRole('button', { name: t.myVisibility.fix.unanswered }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/matches'));
      check(true, '"Open my chats" opens the matches');

      // 3. One reply lifts it at once.
      await dan.call('POST', `/v1/matches/${matches[0]}/messages`, {
        clientId: `msg-acc-${(sent += 1)}-e2e`,
        text: 'Sorry for the wait!',
      });
      await A.page.goto(`${WEB}/visibility`);
      await A.page.getByTestId('vis-visible').waitFor();
      check(
        (await A.page.getByTestId('vis-visible').innerText()).includes(t.myVisibility.visible),
        'after one reply: "You’re visible"',
      );
      await audit(A.page, `${locale}/my-visibility-visible`);
      await shot(A.page, `${locale}/176-visible`);
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
process.stdout.write('\nMy visibility: OK\n');
