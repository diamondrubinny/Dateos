// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 73b end to end, between two real servers: an admin of community A turns trust signals on
 * in the dashboard (B already has); B bans a member; A's dashboard then shows the signal on the
 * partner and an automatic report for A's member whose photo looks the same (for review, nothing
 * else); B lifts the ban and A forgets the signal.
 *
 * Needs the same two servers as `federated-discovery` (A on :4000, B on :4100). Each server sends
 * its outbox once a minute, so this takes a few minutes.
 * Usage: pnpm --dir e2e trust-signals
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import {
  API,
  apiClient,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetRouteLimits,
  shot,
  signInHttp,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const B = process.env.B_URL ?? 'http://localhost:4100';
const B_DB =
  process.env.B_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/\/dateos$/, '/dateos_b');
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const COMMUNITY_B = 'Haifa Rainbow';

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

/** The automatic report a partner's signal opens (other automatic reports may exist too). */
const signalReport = `SELECT id FROM reports WHERE reported_id = $1 AND details LIKE '%partner community%'`;

type Pool = ReturnType<typeof createDb>['pool'];

async function adminOf(pool: Pool, base: string, label: string) {
  const email = `signals73-${label}-${Date.now()}@example.test`;
  const session = await signInHttp(email, base);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header, base);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { call, session };
}

/** Waits for a condition, checking every 2 seconds (the outbox runs once a minute). */
async function until(what: () => Promise<boolean>, ms = 150_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await what()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function open(
  browser: Browser,
  locale: 'en' | 'he',
  session: { name: string; value: string },
) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

async function run(browser: Browser, locale: 'en' | 'he', poolA: Pool, poolB: Pool) {
  const a = adminMessages[locale].partners;
  for (const pool of [poolA, poolB]) {
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM federation_partners');
    await pool.query('DELETE FROM federation_signals_out');
  }
  await poolA.query(`DELETE FROM reports WHERE automatic`);
  await resetRouteLimits();
  const adminA = await adminOf(poolA, API, 'a');
  const adminB = await adminOf(poolB, B, 'b');
  await adminA.call('PATCH', '/v1/admin/instance', { shareTrustSignals: false });
  await adminB.call('PATCH', '/v1/admin/instance', { shareTrustSignals: true });
  await adminA.call('POST', '/v1/admin/partners', { url: B, agreementConfirmed: true });
  const atB = await adminB.call<{ partners: { id: string; url: string }[] }>(
    'GET',
    '/v1/admin/partners',
  );
  const fromA = atB.partners.find((x) => x.url === new URL(API).origin)!;
  await adminB.call('POST', `/v1/admin/partners/${fromA.id}/accept`, { agreementConfirmed: true });

  // Kim at A, and Max at B with a photo one bit away (a re-saved copy, say).
  const base = locale === 'he' ? 0x7000_0000_0000 : 4_000_000;
  const kim = await onboardMember(`signals73-${locale}`, 'Kim', 'woman', ['man']);
  await poolA.query('UPDATE photos SET phash = $2 WHERE user_id = $1', [kim.id, base + 1]);
  const max = await onboardMember(`signals73-${locale}`, 'Max', 'man', ['woman'], B);
  const eve = await onboardMember(`signals73-${locale}`, 'Eve', 'woman', ['man'], B);
  await poolB.query('UPDATE photos SET phash = $2 WHERE user_id = $1', [max.id, base]);

  const D = await open(browser, locale, adminA.session);
  try {
    // 1. A's admin turns trust signals on in the dashboard.
    await D.page.goto(`${ADMIN}/#/partners`);
    const box = D.page.getByRole('checkbox', { name: a.signalsLabel });
    await box.waitFor();
    check(!(await box.isChecked()), 'off by default');
    await box.check();
    await D.page.getByRole('button', { name: a.savePrivacy, exact: true }).click();
    await D.page.getByText(a.savedPrivacy).waitFor();
    check(true, 'trust signals turned on');
    await audit(D.page, `${locale}/admin-trust-signals`);
    await box.scrollIntoViewIfNeeded();
    await shot(D.page, `${locale}/admin-15-trust-signals`);

    // 2. B bans Max: the signal reaches A, and Kim gets a review (nothing else).
    const { reportId } = await eve.call<{ reportId: string }>('POST', '/v1/reports', {
      targetId: max.id,
      category: 'scam',
      block: true,
    });
    await adminB.call('POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'ban',
      reason: 'Scam',
      explanation: 'Messages you sent broke the community guidelines.',
    });
    const arrived = await until(
      async () =>
        (await poolA.query('SELECT 1 FROM federation_signals_in')).rowCount === 1 &&
        (await poolA.query(signalReport, [kim.id])).rowCount === 1,
    );
    check(arrived, 'the signal arrived at A and opened a report on Kim');
    const kimNow = (await poolA.query(`SELECT status FROM "user" WHERE id = $1`, [kim.id])).rows[0];
    check(kimNow?.status === 'active', 'Kim is untouched: only a review');

    await D.page.reload();
    await D.page.getByText(a.signals.replace('{{n}}', '1')).waitFor();
    check(true, 'the partner shows one trust signal kept');
    const report = (await poolA.query(signalReport, [kim.id])).rows[0].id as string;
    await D.page.goto(`${ADMIN}/#/reports/${report}`);
    await D.page.getByText(`“${COMMUNITY_B}” banned (scam)`, { exact: false }).waitFor();
    check(true, 'the report says which partner, why, and that it is not proof');
    await audit(D.page, `${locale}/admin-signal-report`);
    await D.page.locator('#details-title').scrollIntoViewIfNeeded();
    await shot(D.page, `${locale}/admin-16-signal-report`);

    // 3. B lifts the ban: A forgets the signal.
    await adminB.call('POST', `/v1/admin/users/${max.id}/unsuspend`, {
      reason: 'Appeal accepted',
    });
    const gone = await until(
      async () => (await poolA.query('SELECT 1 FROM federation_signals_in')).rowCount === 0,
    );
    check(gone, 'lifting the ban at B withdrew the signal at A');
  } finally {
    await D.context.close();
    await adminA.call('PATCH', '/v1/admin/instance', { shareTrustSignals: false });
    await adminB.call('PATCH', '/v1/admin/instance', { shareTrustSignals: false });
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const poolA = createDb(process.env.DATABASE_URL ?? '', { max: 2 }).pool;
const poolB = createDb(B_DB, { max: 2 }).pool;
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(browser, locale, poolA, poolB);
  }
} finally {
  await browser.close();
  await poolA.end();
  await poolB.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nTrust signals: OK\n');
