// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Your devices (phase 29): a member signed in on a laptop and a phone sees both in Settings →
 * Security, signs the phone out from the laptop, and the phone's session stops working.
 * Usage: pnpm --dir e2e devices
 */
import { chromium } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  API,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const T = { en, he, ar, ru } as const;
const ANDROID_APP = 'okhttp/4.12.0';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const member = await onboardMember(
      `devices-${locale}`,
      locale === 'he' ? 'נועה' : 'Noa',
      'woman',
      ['man'],
    );
    // The same account on a phone (the app's networking stack).
    const phone = await signInHttp(member.email, API, ANDROID_APP);
    const phoneMe = () => fetch(`${API}/v1/me`, { headers: { cookie: phone.header } });
    check((await phoneMe()).status === 200, 'the phone is signed in');

    const laptop = await signInHttp(member.email, API, CHROME_WINDOWS);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: LOCALE_TAGS[locale],
    });
    await context.addCookies([
      {
        name: laptop.name,
        value: laptop.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${WEB}/settings`);
    const card = page.getByTestId('signed-in-devices');
    await card.scrollIntoViewIfNeeded();
    const phoneName = t.devices.app.replace('{{os}}', 'Android');
    await card.getByText(phoneName).waitFor();
    const rows = card.getByTestId('device-row');
    check((await rows.count()) === 3, `three devices listed (${await rows.count()})`);
    check(
      (await card.getByText(t.devices.thisDevice, { exact: false }).count()) === 1,
      'one of them is marked as this device',
    );
    await audit(page, `${locale}/devices`);
    await shot(page, `${locale}/96-your-devices`);

    // Sign the phone out from here.
    const phoneRow = rows.filter({ hasText: phoneName });
    await phoneRow.getByRole('button', { name: t.devices.signOut }).click();
    await card.getByText(phoneName).waitFor({ state: 'detached' });
    check((await phoneMe()).status === 401, 'the phone is signed out');

    // Everywhere else: only this browser stays.
    await card.getByRole('button', { name: t.devices.signOutOthers }).click();
    await card
      .getByRole('button', { name: t.devices.signOutOthers })
      .waitFor({ state: 'detached' });
    check((await rows.count()) === 1, 'only this device remains');
    check(
      (await fetch(`${API}/v1/me`, { headers: { cookie: member.session.header } })).status === 401,
      'the first sign-in is signed out too',
    );
    await page.reload();
    await card.waitFor();
    check(page.url().includes('/settings'), 'this browser is still signed in');
    await context.close();
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nYour devices: OK\n');
