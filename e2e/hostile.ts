// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 67b end to end: an admin gives the app a discreet name and marks a country at risk; the
 * browser tab and the manifest use the name, icons are plain; a member choosing a city there is
 * warned and hidden from new people for the trip.
 * Usage: pnpm --dir e2e hostile (API, worker, web app and dashboard running)
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
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
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const API = process.env.API_URL ?? 'http://localhost:4000';
const DISCREET: Record<L, string> = { en: 'Notes', he: 'פתקים' };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  desktop = false,
) {
  const context = await browser.newContext({
    viewport: desktop ? { width: 1280, height: 1000 } : { width: 390, height: 844 },
    deviceScaleFactor: desktop ? 1 : 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession() {
  const email = `hostile-admin-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const boss = await adminSession();
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale].branding;
    const name = DISCREET[locale];
    await boss.call('PATCH', '/v1/admin/instance', { discreetName: name, riskCountries: ['IL'] });
    await new Promise((r) => setTimeout(r, 16_000)); // the instance cache (15 s)

    // ---------------------------------------------------------- the dashboard
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/branding`);
      const field = S.page.getByLabel(a.discreetName);
      await field.waitFor({ timeout: 20_000 });
      check(
        (await field.inputValue()) === name &&
          (await S.page.getByLabel(a.riskCountries).inputValue()) === 'IL',
        'the dashboard shows the discreet name and the countries at risk',
      );
      await field.scrollIntoViewIfNeeded();
      await audit(S.page, `${locale}/admin-discreet`);
      await shot(S.page, `${locale}/admin-37-discreet`);
    } finally {
      await S.context.close();
    }

    // ---------------------------------------------------------- the app and its manifest
    const manifest = (await (await fetch(`${API}/v1/instance/manifest.webmanifest`)).json()) as {
      name: string;
      icons: { src: string }[];
    };
    check(
      manifest.name === name && manifest.icons.every((i) => i.src.includes('?v=discreet')),
      `the installed app is "${manifest.name}", with plain icons`,
    );
    const noa = await onboardMember(
      `hostile-${locale}`,
      locale === 'he' ? 'נועה' : 'Noa',
      'woman',
      ['man'],
    );
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/settings`);
      const search = N.page.getByRole('textbox', { name: t.travel.search });
      await search.waitFor({ timeout: 20_000 });
      await N.page.waitForFunction((n) => document.title === n, name);
      const favicon = await N.page.evaluate(
        () => document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? '',
      );
      check(favicon.includes('?v=discreet'), 'the tab shows the discreet name and a plain icon');
      await search.fill(locale === 'he' ? 'חיפה' : 'haifa');
      await N.page
        .getByRole('radiogroup', { name: t.travel.choose })
        .getByRole('radio')
        .first()
        .click();
      const risk = N.page.getByTestId('travel-risk');
      await risk.waitFor({ timeout: 20_000 });
      check(
        (await risk.innerText()).includes(t.travel.riskWarning) &&
          (await N.page.getByRole('checkbox', { name: t.travel.hideLabel }).isChecked()),
        'choosing a city there warns, and hiding is on by default',
      );
      await risk.scrollIntoViewIfNeeded();
      await audit(N.page, `${locale}/travel-risk`);
      await shot(N.page, `${locale}/161-travel-risk`);
      await N.page
        .getByRole('button', { name: /^(Travel to|נסיעה ל)/ })
        .first()
        .click();
      let travel: { atRisk: boolean; hidden: boolean } | null = null;
      for (let i = 0; i < 40 && !travel; i += 1) {
        travel = (await noa.call<{ travel: typeof travel }>('GET', '/v1/me/travel')).travel;
        if (!travel) await N.page.waitForTimeout(250);
      }
      check(Boolean(travel?.atRisk && travel.hidden), 'the member is hidden from new people there');
      await noa.call('DELETE', '/v1/me/travel');
    } finally {
      await N.context.close();
    }
  }
} finally {
  await boss
    .call('PATCH', '/v1/admin/instance', { discreetName: null, riskCountries: [] })
    .catch(() => undefined);
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nDiscreet app and countries at risk: OK\n');
