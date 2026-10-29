// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 40 end to end: a member describes a photo; someone using a screen reader hears that
 * description on the profile card.
 * Usage: pnpm --dir e2e photo-descriptions
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
const TEXT: Record<L, { her: string; him: string; description: string }> = {
  en: { her: 'Maya', him: 'Dan', description: 'Me hiking at sunrise, with my dog' },
  he: { her: 'מאיה', him: 'דן', description: 'טיול בזריחה, עם הכלב שלי' },
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
    const { her, him, description } = TEXT[locale];
    const maya = await onboardMember(`alt-${locale}`, her, 'woman', ['man']);
    const dan = await onboardMember(`alt-${locale}`, him, 'man', ['woman']);

    // 1. Maya describes her first photo.
    const A = await open(browser, locale, maya);
    try {
      await A.page.goto(`${WEB}/onboarding/photos?edit=1`);
      const section = A.page.getByTestId('photo-descriptions');
      await section.waitFor();
      await section
        .getByLabel(fill(t.photoText.label, { n: 1 }), { exact: true })
        .fill(description);
      await section.getByRole('button', { name: fill(t.photoText.save, { n: 1 }) }).click();
      await section.getByText(t.photoText.saved).waitFor();
      check(true, 'the description is saved');
      await audit(A.page, `${locale}/photo-descriptions`);
      await section.scrollIntoViewIfNeeded();
      await shot(A.page, `${locale}/112-photo-description`);
    } finally {
      await A.context.close();
    }

    // 2. Dan, with a screen reader, hears it on her card.
    const B = await open(browser, locale, dan);
    try {
      await B.page.goto(`${WEB}/profile/${maya.id}`);
      const img = B.page.getByRole('img', { name: new RegExp(description) });
      await img.first().waitFor();
      check(true, 'the photo’s accessible name includes her description');
      await audit(B.page, `${locale}/photo-description-card`);
    } finally {
      await B.context.close();
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
process.stdout.write('\nPhoto descriptions: OK\n');
