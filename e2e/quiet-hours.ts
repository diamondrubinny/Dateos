// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 39 end to end: Settings → Quiet hours, in the device's time zone (23:00–08:00 by default,
 * moved in half hours), saved on the server and turned off again.
 * Usage: pnpm --dir e2e quiet-hours
 */
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
const TZ = 'Asia/Jerusalem';

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
    timezoneId: TZ,
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

type Settings = { quietHours: { start: number; end: number; timeZone: string } | null };

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const maya = await onboardMember(
      `quiet-${locale}`,
      locale === 'he' ? 'מאיה' : 'Maya',
      'woman',
      ['man'],
    );
    const A = await open(browser, locale, maya);
    try {
      await A.page.goto(`${WEB}/settings`);
      const card = A.page.getByTestId('quiet-hours');
      await card.scrollIntoViewIfNeeded();
      await card.getByRole('checkbox', { name: t.quiet.label }).click();
      await card.getByText(fill(t.quiet.start, { time: '23:00' })).waitFor();
      await card.getByText(fill(t.quiet.end, { time: '08:00' })).waitFor();
      let saved = await maya.call<Settings>('GET', '/v1/me/settings');
      check(
        saved.quietHours?.start === 1380 &&
          saved.quietHours.end === 480 &&
          saved.quietHours.timeZone === TZ,
        `23:00–08:00 in the device's time zone (${saved.quietHours?.timeZone})`,
      );

      // Start half an hour later.
      await A.page
        .getByTestId('quiet-start')
        .getByRole('button', { name: t.quiet.later, exact: true })
        .click();
      await card.getByText(fill(t.quiet.start, { time: '23:30' })).waitFor();
      saved = await maya.call<Settings>('GET', '/v1/me/settings');
      check(saved.quietHours?.start === 1410, 'moved by half an hour, saved on the server');
      await audit(A.page, `${locale}/quiet-hours`);
      await card.scrollIntoViewIfNeeded();
      await shot(A.page, `${locale}/111-quiet-hours`);

      // Off again.
      await card.getByRole('checkbox', { name: t.quiet.label }).click();
      await card.getByTestId('quiet-start').waitFor({ state: 'detached' });
      saved = await maya.call<Settings>('GET', '/v1/me/settings');
      check(saved.quietHours === null, 'turned off');
    } finally {
      await A.context.close();
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
process.stdout.write('\nQuiet hours: OK\n');
