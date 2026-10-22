// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * The "Powered by NexaHeart · Open source" credit (phase 17): visible on the app's public screens
 * and on "check your email" in every language, and in the moderation dashboard in Hebrew and
 * English, with both links going to the right place (nexaheart.com and this instance's source).
 * Keeping it is an additional term of the license (see NOTICE).
 * Usage: pnpm --dir e2e credit
 */
import { CREDIT_TEXT, CREDIT_URL, UPSTREAM_SOURCE_URL } from '@nexaheart/shared';
import { chromium, type Page } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { audit, locales, reportA11y, resetSignInLimits, shot, WEB } from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he, ar, ru } as const;
const SCREENS = ['/welcome', '/sign-in', '/privacy', '/terms', '/accessibility', '/cookies'];

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

/** Opening a link records its address instead of leaving the page. */
const RECORD_OPEN = `
  window.__opened = [];
  window.open = (url) => { window.__opened.push(String(url)); return null; };
`;
const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

/** The same address once normalised (the browser adds the trailing slash of a bare domain). */
const same = (a: string | undefined, b: string) =>
  a !== undefined && new URL(a).href === new URL(b).href;

/** Both parts are visible, readable, and link where they should. */
async function checkCredit(
  page: Page,
  where: string,
  text: { poweredBy: string; openSource: string },
) {
  const poweredBy = page.getByRole('link', { name: text.poweredBy, exact: true });
  const openSource = page.getByRole('link', { name: text.openSource, exact: true });
  const visible = (await poweredBy.isVisible()) && (await openSource.isVisible());
  check(visible, `${where}: "${text.poweredBy} · ${text.openSource}" is visible`);
  if (!visible) return;
  const size = await poweredBy.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const opacity = await poweredBy.evaluate((el) => Number(getComputedStyle(el).opacity));
  check(size >= 12 && opacity > 0.5, `${where}: readable (${size}px)`);
  const href = await poweredBy.getAttribute('href');
  if (href !== null) {
    // The dashboard uses plain links.
    check(href === CREDIT_URL, `${where}: "${text.poweredBy}" → ${href}`);
    const source = await openSource.getAttribute('href');
    check(source === UPSTREAM_SOURCE_URL, `${where}: "${text.openSource}" → ${source}`);
    return;
  }
  await poweredBy.click();
  await openSource.click();
  const urls = await opened(page);
  check(same(urls[0], CREDIT_URL), `${where}: "${text.poweredBy}" opens ${urls[0]}`);
  check(same(urls[1], UPSTREAM_SOURCE_URL), `${where}: "${text.openSource}" opens ${urls[1]}`);
}

// Every locale asks for a sign-in link from one IP (the real per-IP limit is 5 per 10 minutes).
await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
    await context.addInitScript({ content: RECORD_OPEN });
    const page = await context.newPage();
    for (const path of SCREENS) {
      await page.goto(`${WEB}${path}`);
      await page.getByTestId('powered-by').waitFor();
      await checkCredit(page, `${locale}${path}`, CREDIT_TEXT[locale]);
      await audit(page, `${locale}-credit${path.replace('/', '-')}`);
      if (path === '/welcome') {
        await page.getByTestId('powered-by').scrollIntoViewIfNeeded();
        await shot(page, `${locale}/60-powered-by`);
      }
    }
    // "Check your email" after asking for a sign-in link.
    await page.goto(`${WEB}/sign-in`);
    await page.getByLabel(t.signIn.email).fill(`credit-${locale}@example.org`);
    await page.getByRole('button', { name: t.signIn.submit }).click();
    await page.getByText(t.checkEmail.title).first().waitFor();
    await checkCredit(page, `${locale}/check-email`, CREDIT_TEXT[locale]);
    await context.close();
  }

  for (const locale of ['he', 'en'] as const) {
    process.stdout.write(`dashboard ${locale}:\n`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
    const page = await context.newPage();
    await page.goto(ADMIN);
    await page.locator('footer.powered-by').waitFor();
    await checkCredit(page, `dashboard ${locale}`, CREDIT_TEXT[locale]);
    await audit(page, `admin-${locale}-credit`);
    await context.close();
  }
} finally {
  await browser.close();
}
reportA11y();
process.stdout.write(
  problems.length ? `\n${problems.length} problem(s)\n` : '\ncredit checks passed\n',
);
if (problems.length) process.exitCode = 1;
