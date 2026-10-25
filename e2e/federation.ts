// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Communities that connect, step 28a, end to end between two real servers: community A (the usual
 * dev API) invites community B (a second API with its own database, see below) from the dashboard,
 * B's admin accepts, A tests the signed connection, replaces its signing key (B learns it) and tests
 * again, and A ends it. In English and Hebrew.
 *
 * Needs both APIs with FEDERATION=on and INTEGRATIONS_ALLOW_PRIVATE=true (local addresses):
 *   A: the dev API on :4000;  B: PORT=4100 PUBLIC_API_URL=http://localhost:4100 and another
 *   DATABASE_URL (e.g. …/dateos_b). Set B_URL and B_DATABASE_URL if they differ.
 * Usage: pnpm --dir e2e federation
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { API, apiClient, reportA11y, resetRouteLimits, shot, signInHttp } from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const B = process.env.B_URL ?? 'http://localhost:4100';
const B_DB =
  process.env.B_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/\/dateos$/, '/dateos_b');

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

type Pool = ReturnType<typeof createDb>['pool'];
type PartnersResponse = {
  partners: { id: string; url: string; name: string; status: string; lastError: string | null }[];
};

async function adminOf(pool: Pool, base: string, label: string) {
  const email = `federation-${label}-${Date.now()}@example.test`;
  const session = await signInHttp(email, base);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header, base);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

async function open(
  browser: Browser,
  locale: 'en' | 'he',
  session: { name: string; value: string },
) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    locale: locale === 'he' ? 'he-IL' : 'en-US',
  });
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
  await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

async function run(
  browser: Browser,
  locale: 'en' | 'he',
  a: Awaited<ReturnType<typeof adminOf>>,
  b: Awaited<ReturnType<typeof adminOf>>,
) {
  const p = adminMessages[locale].partners;
  const S = await open(browser, locale, a.session);
  try {
    // 1. A invites B from the dashboard, after confirming the agreement.
    await S.page.goto(`${ADMIN}/#/partners`);
    await S.page.getByRole('heading', { name: p.title, level: 1 }).waitFor();
    await S.page.getByLabel(p.inviteLabel).fill(B);
    const send = S.page.getByRole('button', { name: p.invite });
    check(await send.isDisabled(), 'inviting needs the agreement confirmed');
    await S.page.getByLabel(p.agreementInvite).check();
    await send.click();
    await S.page.getByText(p.invited).waitFor();
    await S.page.getByText(p.status.invited_out, { exact: true }).waitFor();
    check(true, 'A invited B; the invitation waits for B');

    // 2. B's admin sees who invited them, and accepts.
    const atB = await b.call<PartnersResponse>('GET', '/v1/admin/partners');
    const fromA = atB.partners.find((x) => x.url === new URL(API).origin);
    check(fromA?.status === 'invited_in', 'B received a signed invitation from A');
    await b.call('POST', `/v1/admin/partners/${fromA!.id}/accept`, { agreementConfirmed: true });

    // 3. A sees them connected, and tests the signed connection.
    await S.page.reload();
    await S.page.getByText(p.status.active, { exact: true }).waitFor();
    await S.page.getByRole('button', { name: `${p.test} Haifa Rainbow` }).click();
    await S.page.getByText(p.tested).waitFor();
    const atA = await a.call<PartnersResponse>('GET', '/v1/admin/partners');
    check(
      atA.partners[0]?.status === 'active' && atA.partners[0]?.lastError === null,
      'A and B are connected; the signed ping works',
    );
    await shot(S.page, `${locale}/admin-18-partners`);

    // 3b. A replaces its signing key; B is told (signed with the old key) and the ping still works.
    await S.page.getByRole('button', { name: p.rotate }).click();
    await S.page.getByRole('button', { name: p.rotateYes }).click();
    await S.page.getByText(p.rotated).waitFor();
    await S.page.getByRole('button', { name: `${p.test} Haifa Rainbow` }).click();
    await S.page.getByText(p.tested).waitFor();
    const rotated = await a.call<PartnersResponse>('GET', '/v1/admin/partners');
    check(
      rotated.partners[0]?.lastError === null,
      'after replacing the key, the signed connection still works',
    );

    // 4. A ends it; B is told.
    await S.page.getByRole('button', { name: `${p.end} Haifa Rainbow` }).click();
    await S.page.getByRole('button', { name: p.endYes }).click();
    await S.page.getByText(p.ended).waitFor();
    const after = await b.call<PartnersResponse>('GET', '/v1/admin/partners');
    check(
      after.partners.find((x) => x.url === new URL(API).origin)?.status === 'ended',
      'ending at A ends it at B too',
    );
  } finally {
    await S.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const poolA = createDb(process.env.DATABASE_URL ?? '', { max: 2 }).pool;
const poolB = createDb(B_DB, { max: 2 }).pool;
try {
  for (const pool of [poolA, poolB]) {
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM federation_partners');
  }
  await resetRouteLimits();
  const a = await adminOf(poolA, API, 'a');
  const b = await adminOf(poolB, B, 'b');
  for (const locale of ['en', 'he'] as const) {
    process.stdout.write(`${locale}:\n`);
    for (const pool of [poolA, poolB]) await pool.query('DELETE FROM federation_partners');
    await run(browser, locale, a, b);
  }
} finally {
  await browser.close();
  await poolA.end();
  await poolB.end();
}
reportA11y();
process.stdout.write(
  problems.length ? `\n${problems.length} problem(s)\n` : '\nall checks passed\n',
);
if (problems.length) process.exitCode = 1;
