// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Partner communities, step 28c (chat), end to end between two real servers, in every language:
 * Noa (community A, in the app) and Dan (community B) match; she writes to him in the app, he
 * reads it on his own server and answers, and his answer (and a scam warning on a second message)
 * appears live in her chat. Then he unmatches, and her chat says it ended.
 *
 * Built on the same setup as step 28b: end to end between two real servers, in every language: the
 * communities connect; Noa (community A, in the app) joins, finds Dan from community B in her
 * Partner communities deck, with his photo coming through her own server, and likes him back: a
 * match on both servers. She unmatches (B is told) and leaves (B forgets her).
 *
 * Needs both APIs with FEDERATION=on and INTEGRATIONS_ALLOW_PRIVATE=true (local addresses), and
 * B with its own worker: A is the dev API on :4000; B on :4100 with its own database (dateos_b)
 * and Redis database. Set B_URL and B_DATABASE_URL if they differ.
 * Usage: pnpm --dir e2e federated-chat
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import {
  FEDERATION_CONSENT_VERSION,
  type FederatedMatch,
  type FederatedMessagesPage,
  type FederatedProfile,
} from '@nexaheart/shared';
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
  type OnboardedMember,
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
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;

const TEXT: Record<L, { hello: string; reply: string }> = {
  en: { hello: 'Hi Dan! How is Haifa today?', reply: 'Windy, but lovely. And Tel Aviv?' },
  he: { hello: 'היי דן! מה שלום חיפה היום?', reply: 'סוער, אבל יפה. ומה בתל אביב?' },
  ar: { hello: 'مرحبًا دان! كيف حيفا اليوم؟', reply: 'عاصفة لكنها جميلة. وتل أبيب؟' },
  ru: { hello: 'Привет, Дэн! Как сегодня в Хайфе?', reply: 'Ветрено, но красиво. А в Тель-Авиве?' },
};

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

async function like(m: OnboardedMember) {
  const [card] = await m.call<FederatedProfile[]>('GET', '/v1/federated/deck');
  await m.call('POST', '/v1/federated/interactions', {
    partnerId: card!.partnerId,
    alias: card!.alias,
    kind: 'like',
  });
}

async function run(browser: Browser, locale: L) {
  const t = T[locale];
  const p = t.partners;
  const noa = await onboardMember(`fedchat-${locale}`, 'Noa', 'woman', ['man']);
  const dan = await onboardMember(`fedchat-${locale}`, 'Dan', 'man', ['woman'], B);
  for (const m of [noa, dan]) {
    await m.call('POST', '/v1/federated/join', { version: FEDERATION_CONSENT_VERSION });
  }
  await like(noa);
  await like(dan);
  const [danMatch] = await dan.call<FederatedMatch[]>('GET', '/v1/federated/matches');

  const S = await open(browser, locale, noa.session);
  try {
    // 1. Noa opens the chat from Matches and writes.
    await S.page.goto(`${WEB}/matches`);
    await S.page.getByRole('button', { name: p.openChat.replace('{{name}}', 'Dan') }).click();
    await S.page.getByText(p.chatEmpty.replace('{{name}}', 'Dan')).waitFor();
    await S.page.getByLabel(t.chat.messageLabel).fill(TEXT[locale].hello);
    await S.page.getByRole('button', { name: t.chat.send, exact: true }).click();
    await S.page.getByText(TEXT[locale].hello).last().waitFor();

    // 2. Dan reads it on his own server, and answers.
    let received: FederatedMessagesPage['messages'] = [];
    for (let i = 0; i < 20 && received.length === 0; i++) {
      received = (
        await dan.call<FederatedMessagesPage>(
          'GET',
          `/v1/federated/matches/${danMatch!.id}/messages`,
        )
      ).messages;
      if (received.length === 0) await new Promise((r) => setTimeout(r, 500));
    }
    check(
      received[0]?.body === TEXT[locale].hello && received[0]?.mine === false,
      `the message crossed to community B (${JSON.stringify(received[0] ?? null)})`,
    );
    await dan.call('POST', `/v1/federated/matches/${danMatch!.id}/messages`, {
      text: TEXT[locale].reply,
      clientId: `e2e-${locale}-${Date.now()}`,
    });
    await dan.call('POST', `/v1/federated/matches/${danMatch!.id}/messages`, {
      text: 'can you send me money for my ticket?',
      clientId: `e2e-${locale}-scam-${Date.now()}`,
    });

    // 3. His answer appears live in her chat, with community A's own scam warning.
    await S.page.getByText(TEXT[locale].reply).last().waitFor();
    await S.page.getByText(t.chat.scamTitle, { exact: false }).last().waitFor();
    check(true, 'the answer arrives live, and A flags the scam itself');
    await shot(S.page, `${locale}/105-partners-chat`);

    // 4. Dan unmatches: Noa's open chat ends live, and the composer goes away.
    await dan.call('DELETE', `/v1/federated/matches/${danMatch!.id}`);
    await S.page.getByText(p.chatEnded).last().waitFor();
    check(
      (await S.page.getByLabel(t.chat.messageLabel).count()) === 0,
      'nothing more can be written',
    );
    check(true, 'after Dan unmatches, the chat ends for Noa');
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
