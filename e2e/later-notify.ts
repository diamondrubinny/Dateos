// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 33 end to end: "Maybe later" in Discover puts a profile aside (it waits in Likes, private
 * to the member) and can be removed; the notification choices in Settings are saved.
 * Usage: pnpm --dir e2e later-notify
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
    const maya = await onboardMember(`later-${locale}`, herName, 'woman', ['man']);
    const dan = await onboardMember(`later-${locale}`, hisName, 'man', ['woman']);
    const A = await open(browser, locale, maya);

    // 1. "Maybe later" from Discover.
    await A.page.goto(`${WEB}/discover`);
    const later = A.page.getByRole('button', { name: `⏳ ${t.later.button}`, exact: true });
    await later.waitFor();
    await audit(A.page, `${locale}/maybe-later-button`);
    await later.click();
    let saved = { profiles: [] as { id: string; displayName: string }[] };
    for (let i = 0; i < 20 && saved.profiles.length === 0; i += 1) {
      saved = await maya.call('GET', '/v1/saved');
      if (saved.profiles.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    const first = saved.profiles[0];
    check(saved.profiles.length === 1 && first !== undefined, `one profile in "Maybe later"`);
    const danSees = await dan.call<{ profiles: { id: string }[] }>('GET', '/v1/saved');
    check(danSees.profiles.length === 0, 'nobody else knows');

    await A.page.goto(`${WEB}/likes`);
    const section = A.page.getByTestId('maybe-later');
    await section.waitFor();
    await section.scrollIntoViewIfNeeded();
    check(
      await section.getByText(first.displayName, { exact: false }).first().isVisible(),
      'shown under Likes',
    );
    await audit(A.page, `${locale}/maybe-later`);
    await shot(A.page, `${locale}/103-maybe-later`);
    await section.getByRole('button', { name: t.later.remove }).first().click();
    await section.waitFor({ state: 'detached' });
    check(true, 'removed');

    // 2. Notification choices.
    await A.page.goto(`${WEB}/settings`);
    const box = A.page.getByRole('checkbox', { name: t.notifyChoice.notifyMessages });
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await A.page.waitForTimeout(500);
    const settings = await maya.call<{ notifyMessages: boolean; notifyMatches: boolean }>(
      'GET',
      '/v1/me/settings',
    );
    check(settings.notifyMessages === false && settings.notifyMatches, 'only messages turned off');
    check(await A.page.getByText(t.notifyChoice.always).isVisible(), 'calls and safety: always on');
    await audit(A.page, `${locale}/notify-choices`);
    await shot(A.page, `${locale}/104-notify-choices`);
    await A.context.close();
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nMaybe later and notifications: OK\n');
