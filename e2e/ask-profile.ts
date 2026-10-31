// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 75b end to end: on someone's profile, ask a question; the answer comes from what they wrote
 * ("doesn't say" otherwise). Needs the API with a local model: run `node fake-model.mjs` and start
 * the API with ICEBREAKERS_PROVIDER=ollama OLLAMA_URL=http://localhost:11555.
 * Usage: pnpm --dir e2e ask-profile
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
const DATA: Record<'en' | 'he', { her: string; him: string; yes: string; job: string }> = {
  en: { her: 'Noa', him: 'Dan', yes: 'Does he like hiking?', job: 'What does he do for work?' },
  he: { her: 'נועה', him: 'דן', yes: 'אוהבים טיולים?', job: 'במה עובדים?' },
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
    const d = DATA[locale as 'en' | 'he'];
    const noa = await onboardMember(`ask75-${locale}`, d.her, 'woman', ['man']);
    const dan = await onboardMember(`ask75-${locale}`, d.him, 'man', ['woman']);
    await dan.call('PATCH', '/v1/me/profile', { bio: 'Weekend hiker, weekday baker.' });

    const N = await open(browser, locale, noa);
    try {
      await N.page.goto(`${WEB}/profile/${dan.id}`);
      const box = N.page.getByTestId('ask-profile');
      await box.waitFor();
      const field = N.page.getByLabel(t.ask.label);
      await field.fill(d.yes);
      await N.page.getByRole('button', { name: t.ask.send, exact: true }).click();
      const answer = N.page.getByTestId('ask-answer');
      await answer.waitFor();
      const text = await answer.innerText();
      check(/hiking|טיולים/.test(text), 'a question the profile answers: the answer');
      await box.scrollIntoViewIfNeeded();
      await audit(N.page, `${locale}/ask-profile`);
      await shot(N.page, `${locale}/193-ask-profile`);
      await field.fill(d.job);
      await N.page.getByRole('button', { name: t.ask.send, exact: true }).click();
      await N.page.getByText(t.ask.notSaid.replace('{{name}}', d.him)).waitFor();
      check(true, 'a question it doesn’t answer: “the profile doesn’t say”');
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
process.stdout.write('\nAsk about a profile: OK\n');
