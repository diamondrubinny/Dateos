// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Integrations (phase 24) end to end:
 * - In the dashboard (English and Hebrew): connect webhooks and bot protection, see that secrets
 *   are never shown again, and test both for real (a local receiver; Cloudflare's test keys).
 * - In the app (every language): the sign-in page shows the CAPTCHA and the link is sent with it.
 * - The worker delivers a signed webhook when someone joins.
 * The local API must allow private addresses (INTEGRATIONS_ALLOW_PRIVATE=true in .env) for the
 * receiver on localhost, and have INTEGRATIONS_KEY set.
 * Usage: pnpm --dir e2e integrations
 */
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  apiClient,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetRouteLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;

/** Cloudflare's test keys: the widget always passes and the server always accepts. 📘 */
const TURNSTILE_SITE = '1x00000000000000000000AA';
const TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
const SIGNING = 'whsec_e2e_signing_secret';

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

/** A webhook receiver on localhost that checks every signature. */
const received: { type: string; data: Record<string, string>; valid: boolean }[] = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const header = String(req.headers['x-nexaheart-signature'] ?? '');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
    const expected = createHmac('sha256', SIGNING).update(`${parts.t}.${body}`).digest('hex');
    const payload = JSON.parse(body || '{}') as { type: string; data: Record<string, string> };
    received.push({ type: payload.type, data: payload.data, valid: parts.v1 === expected });
    res.writeHead(204).end();
  });
});
await new Promise<void>((r) => receiver.listen(8790, '127.0.0.1', () => r()));

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string } | null,
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
  });
  if (session) {
    await context.addCookies([
      {
        name: session.name,
        value: session.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

type Pool = ReturnType<typeof createDb>['pool'];
async function adminSession(pool: Pool) {
  const email = `integrations-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

async function dashboard(
  browser: Browser,
  locale: 'en' | 'he',
  admin: Awaited<ReturnType<typeof adminSession>>,
) {
  const a = adminMessages[locale];
  const i = a.integrations;
  const S = await open(browser, locale, admin.session, 1280);
  try {
    await S.page.goto(`${ADMIN}/#/integrations`);
    await S.page.getByRole('heading', { name: i.title, level: 1 }).waitFor();
    await shot(S.page, `${locale}/admin-14-integrations`);
    check(
      await S.page
        .getByRole('article', { name: i.items.email.name })
        .getByText(i.status.env)
        .isVisible(),
      'email set on the server is shown locked',
    );

    // Webhooks to the local receiver.
    const hooks = S.page.getByRole('article', { name: i.items.webhooks.name });
    await hooks.getByRole('button', { name: `${i.setup} ${i.items.webhooks.name}` }).click();
    await hooks.getByLabel(i.fields.url).fill('http://localhost:8790/hook');
    await hooks.getByLabel(i.fields.signingSecret).fill(SIGNING);
    await hooks.getByRole('checkbox', { name: i.options['member.joined'] }).check();
    await hooks.getByRole('button', { name: i.save }).click();
    await S.page.getByText(i.saved.replace('{{name}}', i.items.webhooks.name)).waitFor();
    check(!(await S.page.content()).includes(SIGNING), 'the signing secret is never sent back');
    const saved = S.page.getByRole('article', { name: i.items.webhooks.name });
    await saved.getByRole('button', { name: `${i.test} ${i.items.webhooks.name}` }).click();
    await saved.getByText('Delivered.').first().waitFor({ timeout: 15_000 });
    check(
      received.some((r) => r.type === 'test' && r.valid),
      'the test webhook arrived, signed',
    );
    await saved.getByRole('button', { name: `${i.setup} ${i.items.webhooks.name}` }).click();
    await saved.getByText(i.secretSet).waitFor();
    await saved.scrollIntoViewIfNeeded();
    await shot(S.page, `${locale}/admin-15-webhooks`);

    // Bot protection with Cloudflare's test keys.
    const captcha = S.page.getByRole('article', { name: i.items.captcha.name });
    await captcha.getByRole('button', { name: `${i.setup} ${i.items.captcha.name}` }).click();
    await captcha.getByLabel(i.fields.siteKey).fill(TURNSTILE_SITE);
    await captcha.getByLabel(i.fields.secretKey).fill(TURNSTILE_SECRET);
    await captcha.getByRole('button', { name: i.save }).click();
    await S.page.getByText(i.saved.replace('{{name}}', i.items.captcha.name)).waitFor();
    const savedCaptcha = S.page.getByRole('article', { name: i.items.captcha.name });
    await savedCaptcha.getByRole('button', { name: `${i.test} ${i.items.captcha.name}` }).click();
    await savedCaptcha
      .getByText('The provider accepted the secret key.')
      .first()
      .waitFor({ timeout: 15_000 });
    check(
      await savedCaptcha.getByText('https://challenges.cloudflare.com').isVisible(),
      'the card says which host to allow in the web app’s CSP',
    );
    await savedCaptcha.scrollIntoViewIfNeeded();
    await shot(S.page, `${locale}/admin-16-captcha`);
  } finally {
    await S.context.close();
  }
}

async function signInWithCaptcha(browser: Browser, locale: L) {
  const t = T[locale];
  const A = await open(browser, locale, null);
  try {
    await A.page.goto(`${WEB}/sign-in`);
    await A.page.getByTestId('captcha').waitFor();
    // The test key passes by itself after a moment.
    await A.page.waitForFunction(
      () =>
        Boolean(
          document.querySelector('input[name="cf-turnstile-response"]')?.getAttribute('value'),
        ),
      undefined,
      { timeout: 30_000 },
    );
    await A.page.getByLabel(t.signIn.email).fill(`captcha-${locale}-${Date.now()}@example.test`);
    await shot(A.page, `${locale}/92-sign-in-captcha`);
    await A.page.getByRole('button', { name: t.signIn.submit }).click();
    await A.page.waitForURL((u) => u.pathname.startsWith('/check-email'), { timeout: 20_000 });
    check(true, 'the sign-in link was sent with the CAPTCHA answered');
  } finally {
    await A.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 2 });
let admin: Awaited<ReturnType<typeof adminSession>> | undefined;
try {
  await pool.query('DELETE FROM integrations');
  await pool.query('DELETE FROM rate_limit');
  await resetRouteLimits();
  admin = await adminSession(pool);
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`dashboard ${locale}:\n`);
    // Through the API, which also clears its few-second cache.
    for (const id of ['webhooks', 'captcha']) {
      await admin.call('DELETE', `/v1/admin/integrations/${id}`).catch(() => undefined);
    }
    await dashboard(browser, locale, admin);
  }
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`app ${locale}:\n`);
    await pool.query('DELETE FROM rate_limit');
    await signInWithCaptcha(browser, locale);
  }
  // Someone joins: the worker delivers member.joined, signed.
  process.stdout.write('webhooks:\n');
  await pool.query('DELETE FROM rate_limit');
  // Sign-in now needs the CAPTCHA: the helper signs in before it's on, so turn it off for it.
  await admin.call('DELETE', '/v1/admin/integrations/captcha');
  const member = await onboardMember('integrations', 'Noa', 'woman', ['man']);
  for (let n = 0; n < 40 && !received.some((r) => r.type === 'member.joined'); n += 1) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const joined = received.find((r) => r.type === 'member.joined');
  check(
    joined?.valid === true &&
      joined.data.memberId === member.id &&
      Object.keys(joined.data).length === 1,
    'the worker delivered member.joined with the member id only, signed',
  );
} finally {
  // Leave the community as it was for the other e2e suites.
  for (const id of ['webhooks', 'captcha']) {
    await admin?.call('DELETE', `/v1/admin/integrations/${id}`).catch(() => undefined);
  }
  await pool.query('DELETE FROM integrations').catch(() => undefined);
  await browser.close();
  await pool.end();
  receiver.close();
}
reportA11y();
process.stdout.write(
  problems.length ? `\n${problems.length} problem(s)\n` : '\nall checks passed\n',
);
if (problems.length) process.exitCode = 1;
