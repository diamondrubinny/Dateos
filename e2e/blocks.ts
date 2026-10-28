// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 35 end to end: Settings → Blocked people lists who I blocked (names only) and unblocks
 * after a confirmation; the Profile tab shows "Profile strength" with what's left to add.
 * Usage: pnpm --dir e2e blocks
 */
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

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = {
  en: ['Maya', 'Dan'],
  he: ['מאיה', 'דן'],
  ar: ['ليلى', 'سامي'],
  ru: ['Маша', 'Дима'],
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

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [herName, hisName] = NAMES[locale];
    const maya = await onboardMember(`blocks-${locale}`, herName, 'woman', ['man']);
    const dan = await onboardMember(`blocks-${locale}`, hisName, 'man', ['woman']);
    await maya.call('POST', '/v1/blocks', { userId: dan.id });
    const A = await open(browser, locale, maya);
    try {
      // 1. Settings → Blocked people.
      await A.page.goto(`${WEB}/settings`);
      await A.page.getByRole('button', { name: t.blocked.open, exact: true }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/blocked'));
      const row = A.page.getByTestId('blocked-person');
      await row.waitFor();
      check((await row.innerText()).includes(hisName), 'Blocked people lists him by name');
      check((await row.locator('img').count()) === 0, 'no photos in the list');
      await audit(A.page, `${locale}/blocked`);
      await shot(A.page, `${locale}/106-blocked`);

      // 2. Unblock asks first, then confirms in words.
      await row.getByRole('button', { name: t.blocked.unblock }).click();
      await A.page.getByText(fill(t.blocked.confirm, { name: hisName })).waitFor();
      await audit(A.page, `${locale}/blocked-confirm`);
      await A.page.getByRole('button', { name: t.blocked.unblockYes }).click();
      await A.page.getByText(fill(t.blocked.done, { name: hisName })).waitFor();
      await A.page.getByTestId('blocked-empty').waitFor();
      check(true, 'unblocked after confirming; the list is empty');
      const left = await maya.call<{ blocked: unknown[] }>('GET', '/v1/blocks');
      check(left.blocked.length === 0, 'the server has no block left');

      // 3. Profile strength on the Profile tab (onboarded with one photo and no bio).
      await A.page.goto(`${WEB}/profile`);
      const card = A.page.getByTestId('profile-strength');
      await card.waitFor();
      const text = await card.innerText();
      check(text.includes(t.strength.title), 'Profile strength is shown');
      check(
        text.includes(`○ ${fill(t.strength.items.verified, {})}`),
        'photo verification is listed as missing',
      );
      await audit(A.page, `${locale}/profile-strength`);
      await card.scrollIntoViewIfNeeded();
      await shot(A.page, `${locale}/107-profile-strength`);
      await card.getByRole('link', { name: new RegExp(fill(t.strength.items.bio, {})) }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/edit-bio'));
      check(true, 'a missing item opens where it is added');
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
process.stdout.write('\nBlocked people and profile strength: OK\n');
