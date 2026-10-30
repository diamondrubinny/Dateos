// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 55 end to end: the server doesn't answer for a while (an update, a restart). A signed-in
 * member who opens the app then is told so, not shown the welcome page, and carries on by
 * themselves when it's back; while using the app, one banner instead of errors, gone when it's
 * back; the dashboard the same. The outage is simulated in the browser, as Caddy answers it
 * (infra/web/Caddyfile): no answer at all, or 503 SERVER_RESTARTING.
 * Usage: pnpm --dir e2e outage
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type BrowserContext } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import {
  API,
  audit,
  LOCALE_TAGS,
  locales,
  magicLink,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he } as const;

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

/** The API stops answering: as the network sees it, or as Caddy answers for it. */
async function down(context: BrowserContext, how: 'no-answer' | 'restarting', origin: string) {
  await context.route(`${API}/**`, (route) =>
    how === 'no-answer'
      ? route.abort('connectionrefused')
      : route.fulfill({
          status: 503,
          headers: {
            'content-type': 'application/json',
            'retry-after': '30',
            'access-control-allow-origin': origin,
            'access-control-allow-credentials': 'true',
          },
          body: JSON.stringify({
            error: { code: 'SERVER_RESTARTING', message: 'The server is restarting.' },
          }),
        }),
  );
}
const up = (context: BrowserContext) => context.unroute(`${API}/**`);

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const member = await onboardMember(`outage-${locale}`, 'Noa', 'woman', ['man']);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: LOCALE_TAGS[locale],
    });
    await context.addCookies([
      {
        name: member.session.name,
        value: member.session.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      // 1. Opening the app while the server doesn't answer.
      await down(context, 'no-answer', WEB);
      await page.goto(`${WEB}/`);
      await page.getByText(t.server.unreachableTitle).first().waitFor({ timeout: 15_000 });
      check(!page.url().includes('/welcome'), 'not sent to the welcome page');
      check(
        (await page.getByText(t.server.unreachableBody).count()) === 1,
        'says what it likely is, and that nobody was signed out',
      );
      await audit(page, `${locale}/server-unreachable`);
      await shot(page, `${locale}/131-server-unreachable`);

      // 2. It comes back: the app carries on by itself, without a reload.
      await up(context);
      await page.waitForURL((url) => url.pathname === '/discover', { timeout: 25_000 });
      check(true, 'carries on to Discover by itself when the server is back');

      // 3. While using the app: one banner (Caddy's 503), then gone when it's back.
      await down(context, 'restarting', WEB);
      await page.getByRole('tab', { name: new RegExp(t.tabs.matches) }).click();
      const banner = page.getByTestId('server-status');
      await banner.waitFor({ timeout: 15_000 });
      check((await banner.innerText()).includes(t.server.banner), 'the banner while using it');
      check(!page.url().includes('/welcome'), 'still signed in, still in the app');
      await audit(page, `${locale}/server-banner`);
      await shot(page, `${locale}/132-server-banner`);
      await up(context);
      await banner.waitFor({ state: 'detached', timeout: 25_000 });
      check(true, 'the banner goes when the server is back');

      // 4. Signed out is still signed out: a real 401 goes to the welcome page.
      await context.clearCookies();
      await page.goto(`${WEB}/`);
      await page.waitForURL((url) => url.pathname === '/welcome', { timeout: 15_000 });
      check(true, 'a signed-out visitor still gets the welcome page');
    } finally {
      await context.close();
    }

    // 5. The dashboard.
    const a = adminMessages[locale];
    const email = `outage-admin-${locale}-${Date.now()}@example.test`;
    await signInHttp(email);
    await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
    await pool.query('DELETE FROM rate_limit');
    const admin = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: LOCALE_TAGS[locale],
    });
    await admin.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
    const dash = await admin.newPage();
    dash.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await dash.goto(`${ADMIN}/`);
      await dash.getByLabel(a.signIn.email).fill(email);
      await dash.getByRole('button', { name: a.signIn.submit }).click();
      await dash.getByText(a.signIn.sent).waitFor();
      await dash.goto(await magicLink(email));
      await dash.getByRole('button', { name: a.mfa.start }).click();
      const secret = (await dash.locator('code.secret').innerText()).replace(/\s/g, '');
      await dash.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
      await dash.getByRole('button', { name: a.mfa.submit }).click();
      await dash.getByRole('heading', { name: a.reports.title }).waitFor();

      await down(admin, 'restarting', ADMIN);
      await dash.reload();
      const box = dash.getByTestId('server-unreachable');
      await box.waitFor({ timeout: 15_000 });
      check(
        (await box.innerText()).includes(a.unreachable.title),
        'the dashboard says the server can’t be reached, not "something went wrong"',
      );
      check((await dash.getByLabel(a.signIn.email).count()) === 0, 'not sent to sign in');
      await audit(dash, `${locale}/admin-server-unreachable`);
      await shot(dash, `${locale}/133-admin-server-unreachable`);
      await up(admin);
      await dash.getByRole('heading', { name: a.reports.title }).waitFor({ timeout: 25_000 });
      check(true, 'the dashboard carries on by itself when the server is back');
    } finally {
      await admin.close();
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
process.stdout.write('\nShort outages: OK\n');
