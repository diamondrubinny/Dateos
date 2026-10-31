// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 68b end to end: a member makes a matchmaking-résumé link for "Mom" with chosen sections;
 * someone without an account opens it and sees the banner, the card and the watermarked photo;
 * the member stops sharing and the page then says the link isn't valid.
 * Usage: pnpm --dir e2e resume (API, worker and web app running)
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
} from './lib.ts';

const T = { en, he } as const;
type L = keyof typeof T;
const NAME: Record<L, string> = { en: 'Noa', he: 'נועה' };
const LABEL: Record<L, string> = { en: 'Mom', he: 'אמא' };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

async function open(browser: Browser, locale: L, session?: { name: string; value: string }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  if (session) {
    await context.addCookies([
      { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
  }
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
    const label = LABEL[locale];
    const noa = await onboardMember(`resume-${locale}`, NAME[locale], 'woman', ['man']);

    // ---------------------------------------------------------- Noa makes a link for Mom
    const N = await open(browser, locale, noa.session);
    let url = '';
    try {
      await N.page.goto(`${WEB}/resume`);
      const field = N.page.getByLabel(t.resume.label, { exact: true });
      await field.waitFor({ timeout: 20_000 });
      await field.fill(label);
      await N.page.getByRole('checkbox', { name: t.resume.section.prompts }).click();
      await N.page.getByRole('button', { name: t.resume.create }).click();
      const made = N.page.getByTestId('resume-made');
      await made.waitFor({ timeout: 20_000 });
      url = /https?:\/\/\S+\/resume\/\S+/.exec(await made.innerText())?.[0] ?? '';
      await N.page.getByTestId('resume-link').waitFor();
      check(url.includes('/resume/'), 'the member makes a link for one person');
      await audit(N.page, `${locale}/resume-links`);
      await shot(N.page, `${locale}/165-resume-links`);
    } finally {
      await N.context.close();
    }

    // ---------------------------------------------------------- Mom opens it, signed out
    const M = await open(browser, locale);
    try {
      await M.page.goto(url.replace(/^https?:\/\/[^/]+/, WEB));
      const banner = M.page.getByTestId('resume-banner');
      await banner.waitFor({ timeout: 20_000 });
      const card = M.page.getByTestId('resume-card');
      const text = await card.innerText();
      check(
        (await banner.innerText()).includes(label) &&
          text.includes(NAME[locale]) &&
          text.includes('Coffee by the sea'),
        'the page says whom it was shared with and shows the chosen sections',
      );
      const img = M.page.getByRole('img', { name: fill(t.resume.photoOf, { name: NAME[locale] }) });
      await img.waitFor();
      await M.page.waitForTimeout(1500);
      check(!text.includes('@'), 'no email on the page');
      await audit(M.page, `${locale}/resume-page`);
      await shot(M.page, `${locale}/166-resume-page`);
    } finally {
      await M.context.close();
    }

    // ---------------------------------------------------------- Noa stops sharing
    const N2 = await open(browser, locale, noa.session);
    try {
      await N2.page.goto(`${WEB}/resume`);
      await N2.page.getByRole('button', { name: fill(t.resume.end, { label }) }).click();
      await N2.page.getByText(t.resume.none).waitFor({ timeout: 20_000 });
    } finally {
      await N2.context.close();
    }
    const M2 = await open(browser, locale);
    try {
      await M2.page.goto(url.replace(/^https?:\/\/[^/]+/, WEB));
      await M2.page.getByText(t.resume.invalid).waitFor({ timeout: 20_000 });
      check(true, 'after stopping, the page says the link isn’t valid');
    } finally {
      await M2.context.close();
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
process.stdout.write('\nMatchmaking résumé: OK\n');
