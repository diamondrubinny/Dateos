// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 29b end to end: passing on someone in Discover and bringing them back with Undo; reacting
 * to a message with the keyboard-friendly picker, seen live by the other person, and removed.
 * Usage: pnpm --dir e2e reactions-undo
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
    const maya = await onboardMember(`react-${locale}`, herName, 'woman', ['man']);
    const dan = await onboardMember(`react-${locale}`, hisName, 'man', ['woman']);

    // 1. Undo a pass in Discover.
    const A = await open(browser, locale, maya);
    await A.page.goto(`${WEB}/discover`);
    const pass = A.page.getByRole('button', { name: `✕ ${t.discover.pass}`, exact: true });
    await pass.waitFor();
    await pass.click();
    const undo = A.page.getByTestId('undo-pass');
    await undo.waitFor();
    await undo.scrollIntoViewIfNeeded();
    // "You passed on {{name}}." → the name.
    const [pre, post] = t.undo.passed.split('{{name}}') as [string, string];
    const text = (await undo.getByText(pre.trim(), { exact: false }).textContent()) ?? '';
    const name = text.slice(text.indexOf(pre) + pre.length, text.lastIndexOf(post)).trim();
    check(name.length > 0, `the bar names who was passed on (${name})`);
    await audit(A.page, `${locale}/undo-pass`);
    await shot(A.page, `${locale}/97-undo-pass`);
    await undo.getByRole('button', { name: t.undo.button }).click();
    await undo.waitFor({ state: 'detached' });
    const back = A.page.getByText(new RegExp(`^${name}, \\d+$`));
    check(await back.first().isVisible(), `${name} is back in the deck`);

    // 2. Reactions: they match, Dan writes, Maya reacts, Dan sees it live.
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    const { matchId } = await maya.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    await dan.call('POST', `/v1/matches/${matchId}/messages`, {
      text: locale === 'he' ? 'קפה ביום שישי?' : 'Coffee on Friday?',
      clientId: `e2e-${Date.now()}`,
    });
    const B = await open(browser, locale, dan);
    await B.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.goto(`${WEB}/chat/${matchId}`);
    const reactButton = A.page.getByTestId('react-button').last();
    await reactButton.waitFor();
    await reactButton.focus();
    await A.page.keyboard.press('Enter');
    const heart = A.page.getByRole('menuitem', { name: t.reactions.names.heart });
    await heart.waitFor();
    await audit(A.page, `${locale}/reactions-picker`);
    await heart.click();
    const mine = A.page.getByRole('button', {
      name: t.reactions.mine.replace('{{emoji}}', t.reactions.names.heart),
    });
    await mine.waitFor();
    check(true, 'Maya reacted with a heart');
    const theirsLabel = t.reactions.theirs
      .replace('{{name}}', herName)
      .replace('{{emoji}}', t.reactions.names.heart);
    await B.page.getByLabel(theirsLabel).waitFor({ timeout: 10_000 });
    check(true, 'Dan sees it live');
    await shot(B.page, `${locale}/98-reactions`);
    await mine.click();
    await B.page.getByLabel(theirsLabel).waitFor({ state: 'detached', timeout: 10_000 });
    check(true, 'removing it reaches Dan too');
    await A.context.close();
    await B.context.close();
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nUndo and reactions: OK\n');
