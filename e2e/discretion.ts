// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 67a end to end: a member hides their distance, turns on discreet notifications and sets an
 * app lock code; the app asks for it after a reload; a wrong code is refused, the right one opens;
 * "Help near you" shows what the admin listed.
 * Usage: pnpm --dir e2e discretion (API, worker and web app running)
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
  apiClient,
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

const T = { en, he } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = { en: ['Noa', 'Dan'], he: ['נועה', 'דן'] };
const HELP = 'Legal aid line: +972-3-555-0100\nEmergency: 100';
const CODE = '482913';

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
async function open(browser: Browser, locale: L, session: { name: string; value: string }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminCall() {
  const email = `discretion-admin-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return call;
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const admin = await adminCall();
await admin('PATCH', '/v1/admin/instance', { safetyResources: HELP });
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [noaName, danName] = NAMES[locale];
    const noa = await onboardMember(`discretion-${locale}`, noaName, 'woman', ['man']);
    const dan = await onboardMember(`discretion-${locale}`, danName, 'man', ['woman']);

    const N = await open(browser, locale, noa.session);
    try {
      // ---------------------------------------------------------- discretion settings
      await N.page.goto(`${WEB}/settings`);
      for (const label of [t.discretion.hideDistanceLabel, t.discretion.discreetLabel]) {
        const box = N.page.getByRole('checkbox', { name: label });
        await box.waitFor({ timeout: 20_000 });
        await box.click();
      }
      let saved = { hideDistance: false, discreetNotifications: false };
      for (let i = 0; i < 40 && !(saved.hideDistance && saved.discreetNotifications); i += 1) {
        saved = await noa.call('GET', '/v1/me/settings');
        if (!(saved.hideDistance && saved.discreetNotifications)) await N.page.waitForTimeout(250);
      }
      check(saved.hideDistance && saved.discreetNotifications, 'the member turns on both settings');
      const seen = await dan.call<{ distance: unknown; visiting: unknown }>(
        'GET',
        `/v1/profiles/${noa.id}`,
      );
      check(seen.distance === null && seen.visiting === null, 'another member sees no distance');

      // ---------------------------------------------------------- the app lock
      await N.page.goto(`${WEB}/app-lock`);
      await N.page.getByRole('textbox', { name: t.appLock.newCode }).fill(CODE);
      await N.page.getByRole('textbox', { name: t.appLock.again }).fill(CODE);
      await N.page.getByRole('button', { name: t.appLock.turnOn }).click();
      await N.page.getByText(t.appLock.saved).waitFor();
      await audit(N.page, `${locale}/app-lock-settings`);
      await shot(N.page, `${locale}/158-app-lock-settings`);
      await N.page.reload();
      const lock = N.page.getByTestId('app-lock');
      await lock.waitFor({ timeout: 20_000 });
      check(
        (await N.page.getByRole('textbox', { name: t.appLock.newCode }).count()) === 0,
        'after a reload the app asks for the code, and shows nothing else',
      );
      await audit(N.page, `${locale}/app-locked`);
      await shot(N.page, `${locale}/159-app-locked`);
      const field = N.page.getByRole('textbox', { name: t.appLock.code });
      await field.fill('111111');
      await N.page.getByRole('button', { name: t.appLock.open, exact: true }).click();
      await N.page.getByText(t.appLock.wrong).waitFor();
      await field.fill(CODE);
      await N.page.getByRole('button', { name: t.appLock.open, exact: true }).click();
      await N.page.getByRole('textbox', { name: t.appLock.newCode }).waitFor({ timeout: 20_000 });
      check(
        (await N.page.getByTestId('app-lock').count()) === 0,
        'a wrong code is refused; the right one opens the app',
      );

      // ---------------------------------------------------------- help near you
      await N.page.goto(`${WEB}/help-near-you`);
      await field.waitFor({ timeout: 20_000 }); // a new page load asks again
      await field.fill(CODE);
      await N.page.getByRole('button', { name: t.appLock.open, exact: true }).click();
      const help = N.page.getByTestId('safety-resources');
      await help.waitFor({ timeout: 20_000 });
      check((await help.innerText()).includes('Legal aid line'), 'members see the local help');
      await audit(N.page, `${locale}/help-near-you`);
      await shot(N.page, `${locale}/160-help-near-you`);
    } finally {
      await N.context.close();
    }
  }
} finally {
  await admin('PATCH', '/v1/admin/instance', { safetyResources: null }).catch(() => undefined);
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nDiscretion: OK\n');
