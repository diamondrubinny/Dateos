// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Partner communities, step 28d (safety), end to end between two real servers: Noa (community A,
 * in the app) reports Dan from community B in their chat; it lands in B's moderation queue with
 * the chat as evidence; B reviews it and A learns only that it was reviewed. A report from B's
 * side lands in A's dashboard "from Haifa Rainbow", and A's admin suspends and resumes the
 * partnership. The app in four languages, the dashboard in English and Hebrew.
 *
 * Same setup as `federated-discovery` (two APIs, B with its own database and worker).
 * Usage: pnpm --dir e2e federated-safety
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import {
  FEDERATION_CONSENT_VERSION,
  type FederatedMatch,
  type FederatedProfile,
  type ReportDetail,
} from '@nexaheart/shared';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  API,
  apiClient,
  LOCALE_TAGS,
  locales,
  onboardMember,
  type OnboardedMember,
  reportA11y,
  resetRouteLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const B = process.env.B_URL ?? 'http://localhost:4100';
const B_DB =
  process.env.B_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/\/dateos$/, '/dateos_b');
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

type Pool = ReturnType<typeof createDb>['pool'];

async function adminOf(pool: Pool, base: string, label: string) {
  const email = `federated-${label}-${Date.now()}@example.test`;
  const session = await signInHttp(email, base);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header, base);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { call, session };
}
type Admin = Awaited<ReturnType<typeof adminOf>>;

/** Community A invites B, B accepts (the agreement confirmed on both sides). */
async function connect(a: Admin['call'], b: Admin['call']) {
  await a('POST', '/v1/admin/partners', { url: B, agreementConfirmed: true });
  const atB = await b<{ partners: { id: string; url: string }[] }>('GET', '/v1/admin/partners');
  const fromA = atB.partners.find((p) => p.url === new URL(API).origin)!;
  await b('POST', `/v1/admin/partners/${fromA.id}/accept`, { agreementConfirmed: true });
}

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
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
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

async function like(m: OnboardedMember) {
  const [card] = await m.call<FederatedProfile[]>('GET', '/v1/federated/deck');
  await m.call('POST', '/v1/federated/interactions', {
    partnerId: card!.partnerId,
    alias: card!.alias,
    kind: 'like',
  });
}

const COMMUNITY_B = 'Haifa Rainbow';

async function pair(locale: L) {
  const noa = await onboardMember(`fedsafe-${locale}`, 'Noa', 'woman', ['man']);
  const dan = await onboardMember(`fedsafe-${locale}`, 'Dan', 'man', ['woman'], B);
  for (const m of [noa, dan]) {
    await m.call('POST', '/v1/federated/join', { version: FEDERATION_CONSENT_VERSION });
  }
  await like(noa);
  await like(dan);
  const [danMatch] = await dan.call<FederatedMatch[]>('GET', '/v1/federated/matches');
  await dan.call('POST', `/v1/federated/matches/${danMatch!.id}/messages`, {
    text: 'Send me money or I will find you.',
    clientId: `e2e-safety-${locale}-${Date.now()}`,
  });
  return { noa, dan };
}

async function run(browser: Browser, locale: L, a: Admin, b: Admin) {
  const t = T[locale];
  const p = t.partners;
  const { noa, dan } = await pair(locale);
  const before = (await b.call<{ reports: { id: string }[] }>('GET', '/v1/admin/reports')).reports;

  // 1. Noa reports Dan from their chat.
  const S = await open(browser, locale, noa.session);
  try {
    await S.page.goto(`${WEB}/matches`);
    await S.page.getByRole('button', { name: p.openChat.replace('{{name}}', 'Dan') }).click();
    await S.page.getByRole('button', { name: p.report.replace('{{name}}', 'Dan') }).click();
    await S.page.getByRole('radio', { name: t.report.categories.threat }).click();
    await S.page.getByLabel(t.report.details).fill('Threats in our chat.');
    await shot(S.page, `${locale}/106-partners-report`);
    await S.page.getByRole('button', { name: t.report.submit }).click();
    await S.page.getByText(p.reportDone.replace('{{community}}', COMMUNITY_B)).waitFor();
    check(true, 'Noa reported Dan; it went to his community');
  } finally {
    await S.context.close();
  }

  // 2. B's queue has it, with the chat as evidence and no reporter; B reviews it.
  const after = (
    await b.call<{ reports: { id: string; category: string }[] }>('GET', '/v1/admin/reports')
  ).reports;
  const fresh = after.find((r) => !before.some((x) => x.id === r.id));
  const detail = await b.call<ReportDetail>('GET', `/v1/admin/reports/${fresh!.id}`);
  check(
    detail.partnerCommunity !== null &&
      detail.reporter.id === null &&
      detail.evidence.some((e) => e.from === 'reported' && e.body?.includes('Send me money')),
    'B sees the report from a partner member, with the chat as evidence',
  );
  await b.call('POST', `/v1/admin/reports/${fresh!.id}/resolve`, {
    action: 'warn',
    reason: 'Warned for threats.',
    explanation: 'Messages you sent broke the community guidelines.',
  });
  const partners = await a.call<{ partners: { reports: { reviewed: number } }[] }>(
    'GET',
    '/v1/admin/partners',
  );
  check((partners.partners[0]?.reports.reviewed ?? 0) >= 1, 'A learns only that it was reviewed');
  await dan.call('POST', '/v1/federated/leave');
  await noa.call('POST', '/v1/federated/leave');
}

/** The dashboard side (English and Hebrew): a report from B's member, and suspending B. */
async function dashboard(browser: Browser, locale: 'en' | 'he', a: Admin) {
  const d = adminMessages[locale];
  const { noa, dan } = await pair(`${locale}x` as L);
  // Dan reports Noa from his side.
  const [noaMatch] = await dan.call<FederatedMatch[]>('GET', '/v1/federated/matches');
  await dan.call('POST', '/v1/federated/reports', {
    partnerId: noaMatch!.partnerId,
    alias: noaMatch!.alias,
    category: 'harassment',
    details: 'Keeps messaging after I said no.',
  });
  const S = await open(browser, locale, a.session, 1280);
  try {
    const reports = (
      await a.call<{ reports: { id: string; category: string }[] }>('GET', '/v1/admin/reports')
    ).reports;
    const mine = reports.find((r) => r.category === 'harassment')!;
    await S.page.goto(`${ADMIN}/#/reports/${mine.id}`);
    await S.page
      .getByText(d.detail.partnerReporter.replace('{{community}}', COMMUNITY_B))
      .waitFor();
    check(true, 'A’s dashboard shows a report from a member of the partner community');
    await shot(S.page, `${locale}/admin-19-partner-report`);

    await S.page.goto(`${ADMIN}/#/partners`);
    await S.page.getByRole('button', { name: `${d.partners.suspend} ${COMMUNITY_B}` }).click();
    await S.page.getByText(d.partners.suspendedDone).waitFor();
    await S.page.getByText(d.partners.suspendedNote).waitFor();
    const deck = await noa.call<unknown[]>('GET', '/v1/federated/deck');
    check(deck.length === 0, 'while suspended, nothing from B appears at A');
    await shot(S.page, `${locale}/admin-20-partner-suspended`);
    await S.page.getByRole('button', { name: `${d.partners.resume} ${COMMUNITY_B}` }).click();
    await S.page.getByText(d.partners.resumedDone).waitFor();
    check(true, 'the admin suspended and resumed the partnership');
  } finally {
    await S.context.close();
    await dan.call('POST', '/v1/federated/leave');
    await noa.call('POST', '/v1/federated/leave');
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
    await pool.query(`DELETE FROM reports WHERE status = 'open'`);
  }
  await resetRouteLimits();
  const a = await adminOf(poolA, API, 'a');
  const b = await adminOf(poolB, B, 'b');
  await connect(a.call, b.call);
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    for (const pool of [poolA, poolB]) await pool.query('DELETE FROM rate_limit');
    await run(browser, locale, a, b);
  }
  for (const locale of ['en', 'he'] as const) {
    process.stdout.write(`dashboard ${locale}:\n`);
    await dashboard(browser, locale, a);
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
