// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 44 end to end: "See my profile as others do" from the profile tab, the same card with its
 * photo, and the reasons the profile is hidden (incognito here) with a way to fix each.
 * Usage: pnpm --dir e2e preview
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
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

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

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
    const name = locale === 'he' ? 'מאיה' : 'Maya';
    const maya = await onboardMember(`preview-${locale}`, name, 'woman', ['man']);
    const A = await open(browser, locale, maya);
    try {
      await A.page.goto(`${WEB}/profile`);
      await A.page.getByRole('button', { name: t.preview.open }).click();
      await A.page.waitForURL((url) => url.pathname === '/preview');
      await A.page.getByText(t.preview.visible).waitFor();
      check(true, 'a visible profile says so');
      check(
        (await A.page.getByText(name, { exact: false }).count()) > 0,
        'the card shows her name',
      );
      const loaded = await A.page.waitForFunction(
        () =>
          [...document.images].some((img) => img.complete && img.naturalWidth > 0) ||
          [...document.querySelectorAll<HTMLElement>('[style*="background-image"]')].length > 0,
        undefined,
        { timeout: 10_000 },
      );
      check(Boolean(await loaded.jsonValue()), 'her own photo loads');
      await audit(A.page, `${locale}/preview`);
      await shot(A.page, `${locale}/117-preview`);

      // Incognito: the preview says she's hidden from new people, and where to change it.
      await pool.query('UPDATE "user" SET incognito = true WHERE id = $1', [maya.id]);
      await A.page.reload();
      const hidden = A.page.getByTestId('preview-hidden');
      await hidden.waitFor();
      check(
        (await hidden.getByText(t.preview.hidden.incognito).count()) === 1,
        'incognito is named as the reason',
      );
      await audit(A.page, `${locale}/preview-hidden`);
      await shot(A.page, `${locale}/118-preview-hidden`);
      await hidden.getByRole('button', { name: t.preview.fix.incognito }).click();
      await A.page.waitForURL((url) => url.pathname === '/settings');
      check(true, 'the fix opens settings');
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
process.stdout.write('\nProfile preview: OK\n');
