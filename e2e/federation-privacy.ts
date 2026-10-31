// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 73a end to end, between two real servers: Noa (community A, in the app) chooses the short
 * card in Partner communities, and Dan (community B) sees no bio and one photo; an admin of A
 * chooses short cards for everyone and the community's country in the dashboard; A's admin puts
 * B's country on the countries-at-risk list, and after "Test connection" B is flagged.
 *
 * Needs the same two servers as `federated-discovery` (A on :4000, B on :4100).
 * Usage: pnpm --dir e2e federation-privacy
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { FEDERATION_CONSENT_VERSION, type FederatedProfile } from '@nexaheart/shared';
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
  audit,
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
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

type Pool = ReturnType<typeof createDb>['pool'];

async function adminOf(pool: Pool, base: string, label: string) {
  const email = `privacy73-${label}-${Date.now()}@example.test`;
  const session = await signInHttp(email, base);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header, base);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { call, session };
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

async function run(browser: Browser, locale: L, poolA: Pool, poolB: Pool) {
  const t = T[locale];
  const p = t.partners;
  const a = adminMessages[locale as 'en' | 'he'].partners;
  for (const pool of [poolA, poolB]) {
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM federation_partners');
  }
  await resetRouteLimits();
  const adminA = await adminOf(poolA, API, 'a');
  const adminB = await adminOf(poolB, B, 'b');
  await adminA.call('PATCH', '/v1/admin/instance', {
    partnerCards: 'full',
    communityCountry: null,
    riskCountries: [],
  });
  await adminB.call('PATCH', '/v1/admin/instance', { communityCountry: 'GR' });
  await adminA.call('POST', '/v1/admin/partners', { url: B, agreementConfirmed: true });
  const atB = await adminB.call<{ partners: { id: string; url: string }[] }>(
    'GET',
    '/v1/admin/partners',
  );
  const fromA = atB.partners.find((x) => x.url === new URL(API).origin)!;
  await adminB.call('POST', `/v1/admin/partners/${fromA.id}/accept`, { agreementConfirmed: true });

  const noa = await onboardMember(`privacy73-${locale}`, 'Noa', 'woman', ['man']);
  const dan = await onboardMember(`privacy73-${locale}`, 'Dan', 'man', ['woman'], B);
  await dan.call('POST', '/v1/federated/join', { version: FEDERATION_CONSENT_VERSION });
  await noa.call('POST', '/v1/federated/join', { version: FEDERATION_CONSENT_VERSION });
  await noa.call('PATCH', '/v1/me/profile', { bio: 'Noa paints at dawn' });
  const noaCard = async () =>
    (await dan.call<FederatedProfile[]>('GET', '/v1/federated/deck')).find(
      (c) => c.displayName === 'Noa',
    );
  check((await noaCard())?.bio === 'Noa paints at dawn', 'the full card by default');

  // 1. Noa chooses the short card in the app.
  const S = await open(browser, locale, noa.session);
  try {
    await S.page.goto(`${WEB}/partners`);
    const box = S.page.getByRole('checkbox', { name: p.shortLabel });
    await box.waitFor();
    await box.click();
    await S.page.waitForFunction(
      () => document.querySelector('[role="checkbox"][aria-checked="true"]') !== null,
    );
    await poolB.query('DELETE FROM federation_decisions');
    const card = await noaCard();
    check(
      card?.bio === null && card.prompts.length === 0 && card.photos.length === 1,
      'Dan, at community B, sees her short card: no bio, no prompts, one photo',
    );
    await audit(S.page, `${locale}/partners-short-card`);
    await box.scrollIntoViewIfNeeded();
    await shot(S.page, `${locale}/188-partners-short-card`);
  } finally {
    await S.context.close();
  }

  // 2. The admin chooses short cards for everyone, and the community's country.
  const D = await open(browser, locale, adminA.session, 1280);
  try {
    await D.page.goto(`${ADMIN}/#/partners`);
    await D.page.getByRole('radio', { name: a.cardsMinimal }).check();
    await D.page.getByLabel(a.countryLabel).fill('il');
    await D.page.getByRole('button', { name: a.savePrivacy, exact: true }).click();
    await D.page.getByText(a.savedPrivacy).waitFor();
    const self = await (await fetch(`${API}/.well-known/nexaheart`)).json();
    check(self.country === 'IL', 'the community’s country is in its identity');
    const settings = await adminA.call<{ partnerCards: string }>('GET', '/v1/admin/instance');
    check(settings.partnerCards === 'minimal', 'short cards for everyone, saved');
    await audit(D.page, `${locale}/admin-before-match`);
    await D.page.locator('#before-match-title').scrollIntoViewIfNeeded();
    await shot(D.page, `${locale}/admin-13-before-match`);

    // 3. B's country goes on the countries-at-risk list: after a test, B is flagged.
    await adminA.call('PATCH', '/v1/admin/instance', { riskCountries: ['GR'] });
    await D.page.reload();
    await D.page.getByRole('button', { name: new RegExp(a.test) }).click();
    await D.page.getByTestId('partner-at-risk').waitFor();
    check(true, 'a partner in a country at risk is flagged');
    await audit(D.page, `${locale}/admin-partner-at-risk`);
    await D.page.getByTestId('partner-at-risk').scrollIntoViewIfNeeded();
    await shot(D.page, `${locale}/admin-14-partner-at-risk`);
  } finally {
    await D.context.close();
  }

  // 4. With the community's choice, the member sees a note instead of the setting.
  const M = await open(browser, locale, noa.session);
  try {
    await M.page.goto(`${WEB}/partners`);
    await M.page.getByText(p.shortCommunity).waitFor();
    check(true, 'the member sees the community already shows short cards');
  } finally {
    await M.context.close();
  }
  await dan.call('POST', '/v1/federated/leave');
  await adminA.call('PATCH', '/v1/admin/instance', {
    partnerCards: 'full',
    communityCountry: null,
    riskCountries: [],
  });
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
process.stdout.write('\nFederation privacy: OK\n');
