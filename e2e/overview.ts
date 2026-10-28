// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 36 end to end: a moderator opens Dashboard → Overview (counts only); a brand-new account
 * that already started 10 chats today sees a calm message when starting an 11th.
 * Usage: pnpm --dir e2e overview
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { NEW_ACCOUNT_CHAT_STARTS } from '@nexaheart/shared';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
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
type L = keyof typeof T;

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''));

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string } | null,
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
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

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale];

    // 1. A moderator's Overview.
    const email = `overview-mod-${locale}-${Date.now()}@example.test`;
    await signInHttp(email);
    await pool.query(`UPDATE "user" SET role = 'moderator' WHERE email = $1`, [email]);
    await pool.query('DELETE FROM rate_limit');
    const S = await open(browser, locale, null, 1280);
    try {
      await S.page.goto(`${ADMIN}/`);
      await S.page.getByLabel(a.signIn.email).fill(email);
      await S.page.getByRole('button', { name: a.signIn.submit }).click();
      await S.page.getByText(a.signIn.sent).waitFor();
      await S.page.goto(await magicLink(email));
      await S.page.getByRole('button', { name: a.mfa.start }).click();
      const secret = (await S.page.locator('code.secret').innerText()).replace(/\s/g, '');
      await S.page.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
      await S.page.getByRole('button', { name: a.mfa.submit }).click();
      await S.page.getByRole('heading', { name: a.reports.title }).waitFor();
      await S.page.getByRole('link', { name: a.nav.overview, exact: true }).click();
      await S.page.getByRole('heading', { name: a.overview.title, level: 1 }).waitFor();
      const table = S.page.getByRole('table', { name: a.overview.queue });
      await table.waitFor();
      check(
        (await table.innerText()).includes(a.overview.total),
        'the Overview shows the open-report count',
      );
      const text = await S.page.getByTestId('overview').innerText();
      check(!text.includes('@example.test'), 'no email addresses on the Overview');
      await audit(S.page, `${locale}/admin-overview`);
      await shot(S.page, `${locale}/admin-13-overview`);
    } finally {
      await S.context.close();
    }

    // 2. A gentle start: a new account that started 10 chats today, starting an 11th.
    const fresh = await onboardMember(
      `overview-${locale}`,
      locale === 'he' ? 'נועם' : 'Noam',
      'man',
      ['woman'],
    );
    const matchIds: string[] = [];
    for (let i = 0; i <= NEW_ACCOUNT_CHAT_STARTS; i += 1) {
      const her = `overview-her-${locale}-${Date.now()}-${i}`;
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, $1, $1 || '@example.test', true, now(), now())`,
        [her],
      );
      const [x, y] = [fresh.id, her].sort();
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO matches (user_a, user_b) VALUES ($1, $2) RETURNING id',
        [x, y],
      );
      matchIds.push(rows[0]!.id);
    }
    for (const id of matchIds.slice(0, NEW_ACCOUNT_CHAT_STARTS)) {
      await fresh.call('POST', `/v1/matches/${id}/messages`, {
        text: 'Hi, nice to match!',
        clientId: `overview-${locale}-${id}`,
      });
    }
    const A = await open(browser, locale, fresh.session);
    try {
      await A.page.goto(`${WEB}/chat/${matchIds[NEW_ACCOUNT_CHAT_STARTS]}`);
      await A.page.getByLabel(t.chat.messageLabel, { exact: true }).fill('Hello there!');
      await A.page.getByRole('button', { name: t.chat.send, exact: true }).click();
      await A.page
        .getByText(fill(t.chat.newAccountLimit, { count: NEW_ACCOUNT_CHAT_STARTS }))
        .waitFor();
      check(true, 'a calm message about the daily limit for new accounts');
      await audit(A.page, `${locale}/new-account-limit`);
      await shot(A.page, `${locale}/108-new-account-limit`);
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
process.stdout.write('\nOverview and a gentle start: OK\n');
