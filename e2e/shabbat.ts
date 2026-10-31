// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 74a end to end: Noa agrees to Shabbat mode in Settings, sees the next Shabbat's times and
 * tells her matches; Dan, in their chat, sees she's keeping Shabbat if it's Shabbat in Tel Aviv
 * right now (the server's real clock), and nothing otherwise.
 * Usage: pnpm --dir e2e shabbat
 */
import { existsSync } from 'node:fs';
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
const NAMES: Record<L, [string, string]> = {
  en: ['Noa', 'Dan'],
  he: ['נועה', 'דן'],
  ar: ['ليلى', 'سامي'],
  ru: ['Маша', 'Дима'],
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function open(browser: Browser, locale: L, member: OnboardedMember) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
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
    const noa = await onboardMember(`shabbat74-${locale}`, her, 'woman', ['man']);
    const dan = await onboardMember(`shabbat74-${locale}`, him, 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });

    // 1. Noa turns it on in Settings, with its own consent.
    const N = await open(browser, locale, noa);
    try {
      await N.page.goto(`${WEB}/settings`);
      await N.page.getByRole('button', { name: t.shabbat.entry, exact: true }).click();
      await N.page.waitForURL((url) => url.pathname === '/shabbat');
      check(
        (await N.page.getByRole('checkbox', { name: t.shabbat.on }).count()) === 0,
        'nothing to turn on before the consent',
      );
      await N.page.getByRole('checkbox', { name: t.shabbat.consent }).click();
      const on = N.page.getByRole('checkbox', { name: t.shabbat.on });
      await on.waitFor();
      await N.page.waitForFunction(
        (label) =>
          document
            .querySelector(`[role="checkbox"][aria-label="${label}"]`)
            ?.getAttribute('aria-checked') === 'true',
        t.shabbat.on,
      );
      await N.page.getByTestId('shabbat-next').waitFor();
      check(true, 'turned on with the consent; the next times are shown');
      await N.page.getByRole('checkbox', { name: t.shabbat.showMatches }).click();
      await N.page
        .getByRole('radio', { name: t.shabbat.candlesOption.replace('{{n}}', '40') })
        .click();
      await N.page.waitForTimeout(500);
      const settings = await noa.call<{
        on: boolean;
        showMatches: boolean;
        candles: number;
        next: { start: string; end: string } | null;
      }>('GET', '/v1/me/shabbat');
      check(
        settings.on && settings.showMatches && settings.candles === 40 && settings.next !== null,
        'saved: on, matches told, 40 minutes',
      );
      await audit(N.page, `${locale}/shabbat-settings`);
      await shot(N.page, `${locale}/189-shabbat`);

      // 2. Dan's chat: the note only while it's Shabbat for her.
      const now = Date.now();
      const inRest =
        settings.next !== null &&
        Date.parse(settings.next.start) <= now &&
        now < Date.parse(settings.next.end);
      const D = await open(browser, locale, dan);
      try {
        await D.page.goto(`${WEB}/chat/${matchId}`);
        await D.page.getByRole('textbox').first().waitFor();
        if (inRest) {
          await D.page.getByTestId('chat-resting').waitFor();
          check(true, 'it is Shabbat in Tel Aviv now: Dan sees she is keeping it');
          await audit(D.page, `${locale}/chat-resting`);
          await shot(D.page, `${locale}/190-chat-resting`);
        } else {
          await D.page.waitForTimeout(1000);
          check(
            (await D.page.getByTestId('chat-resting').count()) === 0,
            'not Shabbat in Tel Aviv now: no note in the chat',
          );
        }
      } finally {
        await D.context.close();
      }
    } finally {
      await N.context.close();
    }
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nShabbat mode: OK\n');
