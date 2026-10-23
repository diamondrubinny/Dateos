// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Partner communities, step 28b, end to end between two real servers, in every language: the
 * communities connect; Noa (community A, in the app) joins, finds Dan from community B in her
 * Partner communities deck, with his photo coming through her own server, and likes him back: a
 * match on both servers. She unmatches (B is told) and leaves (B forgets her).
 *
 * Needs both APIs with FEDERATION=on and INTEGRATIONS_ALLOW_PRIVATE=true (local addresses), and
 * B with its own worker: A is the dev API on :4000; B on :4100 with its own database (dateos_b)
 * and Redis database. Set B_URL and B_DATABASE_URL if they differ.
 * Usage: pnpm --dir e2e federated-discovery
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { FEDERATION_CONSENT_VERSION, type FederatedProfile } from '@nexaheart/shared';
import { chromium, type Browser } from 'playwright';
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
  reportA11y,
  resetRouteLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const B = process.env.B_URL ?? 'http://localhost:4100';
const B_DB =
  process.env.B_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/\/dateos$/, '/dateos_b');
const COMMUNITY_B = 'Haifa Rainbow';
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
  return call;
}

/** Community A invites B, B accepts (the agreement confirmed on both sides). */
async function connect(poolA: Pool, poolB: Pool) {
  const a = await adminOf(poolA, API, 'a');
  const b = await adminOf(poolB, B, 'b');
  await a('POST', '/v1/admin/partners', { url: B, agreementConfirmed: true });
  const atB = await b<{ partners: { id: string; url: string }[] }>('GET', '/v1/admin/partners');
  const fromA = atB.partners.find((p) => p.url === new URL(API).origin)!;
  await b('POST', `/v1/admin/partners/${fromA.id}/accept`, { agreementConfirmed: true });
}

async function open(browser: Browser, locale: L, session: { name: string; value: string }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

async function run(browser: Browser, locale: L) {
  const t = T[locale];
  const p = t.partners;
  const noa = await onboardMember(`federated-${locale}`, 'Noa', 'woman', ['man']);
  const dan = await onboardMember(`federated-${locale}`, 'Dan', 'man', ['woman'], B);
  await dan.call('POST', '/v1/federated/join', { version: FEDERATION_CONSENT_VERSION });

  const S = await open(browser, locale, noa.session);
  try {
    // 1. Noa reads what's shared and joins (nothing crosses before).
    await S.page.goto(`${WEB}/partners`);
    await S.page.getByText(COMMUNITY_B, { exact: true }).waitFor();
    const join = S.page.getByRole('button', { name: p.join, exact: true });
    check(await join.isDisabled(), 'joining needs the consent ticked');
    await S.page.getByRole('checkbox', { name: p.agree }).click();
    await join.click();
    await S.page.getByText(p.joined).waitFor();
    check(true, 'Noa joined partner communities');
    await shot(S.page, `${locale}/102-partners-join`);

    // 2. Dan (community B) likes Noa first, from his own server.
    const danDeck = await dan.call<FederatedProfile[]>('GET', '/v1/federated/deck');
    const noaCard = danDeck.find((c) => c.displayName === 'Noa');
    check(Boolean(noaCard), 'Dan, on community B, sees Noa from community A');
    await dan.call('POST', '/v1/federated/interactions', {
      partnerId: noaCard!.partnerId,
      alias: noaCard!.alias,
      kind: 'like',
    });

    // 3. Noa finds Dan in her Partner communities deck, his photo through her own server.
    await S.page.goto(`${WEB}/discover`);
    await S.page.getByRole('radio', { name: p.deck, exact: true }).click();
    await S.page.getByText(p.from.replace('{{community}}', COMMUNITY_B)).first().waitFor();
    await S.page.getByText('Dan', { exact: false }).first().waitFor();
    const image = S.page.locator('img').first();
    await image.waitFor();
    await S.page.waitForFunction(() =>
      [...document.images].some((img) => img.complete && img.naturalWidth > 0),
    );
    check(true, 'Dan’s card and photo load through community A');
    await shot(S.page, `${locale}/103-partners-deck`);
    await S.page.getByRole('button', { name: t.discover.like, exact: true }).click();
    await S.page.getByText(p.matched.replace('{{name}}', 'Dan')).waitFor();
    const atB = await dan.call<{ displayName: string }[]>('GET', '/v1/federated/matches');
    check(
      atB.some((m) => m.displayName === 'Noa'),
      'a mutual like is a match on both servers',
    );

    // 4. Matches: from partner communities, chat comes next.
    await S.page.goto(`${WEB}/matches`);
    await S.page.getByTestId('partner-matches').waitFor();
    await S.page.getByText(p.chatSoon).first().waitFor();
    await shot(S.page, `${locale}/104-partners-match`);
    await S.page.getByRole('button', { name: p.unmatch.replace('{{name}}', 'Dan') }).click();
    await S.page.getByRole('button', { name: p.unmatchYes, exact: true }).click();
    await S.page.getByTestId('partner-matches').waitFor({ state: 'detached' });
    const afterUnmatch = await dan.call<unknown[]>('GET', '/v1/federated/matches');
    check(afterUnmatch.length === 0, 'unmatching at A ends the match at B');

    // 5. Noa leaves: B forgets her.
    await S.page.goto(`${WEB}/partners`);
    await S.page.getByRole('button', { name: p.leave, exact: true }).click();
    await S.page.getByRole('button', { name: p.leaveYes, exact: true }).click();
    await S.page.getByText(p.left).waitFor();
    const after = await dan.call<FederatedProfile[]>('GET', '/v1/federated/deck');
    check(!after.some((c) => c.displayName === 'Noa'), 'after leaving, B no longer shows Noa');
  } finally {
    await S.context.close();
    await dan.call('POST', '/v1/federated/leave');
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
  await connect(poolA, poolB);
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    for (const pool of [poolA, poolB]) await pool.query('DELETE FROM rate_limit');
    await run(browser, locale);
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
