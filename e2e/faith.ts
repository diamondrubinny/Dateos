// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 62b end to end: an admin turns the faith module on (Dashboard → Branding → Community
 * profile); a member gives the religion consent and answers faith, stream and Shabbat in the app;
 * another member sees it, with "Marriage", on the card; a stream dealbreaker hides a mismatch.
 * Usage: pnpm --dir e2e faith (API, web app and dashboard running)
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

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = { en: ['Tamar', 'Yoni'], he: ['תמר', 'יוני'] };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession(tag: string) {
  const email = `faith-admin-${tag}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

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

await resetSignInLimits();
await pool.query(
  'INSERT INTO instance_settings (id, setup_completed_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET setup_completed_at = COALESCE(instance_settings.setup_completed_at, now())',
);
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale];
    const [herName, hisName] = NAMES[locale];

    // ------------------------------------------------------------ admin: faith module on
    const boss = await adminSession(locale);
    await boss.call('PATCH', '/v1/admin/instance', { faithModule: false });
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/branding`);
      const card = S.page.locator('form', {
        has: S.page.getByRole('heading', { name: a.branding.communityTitle }),
      });
      await card.waitFor();
      await card.getByLabel(a.branding.faithModule).check();
      await card.getByRole('button', { name: a.branding.communitySave }).click();
      await S.page.getByText(a.branding.communitySaved).waitFor();
      await card.scrollIntoViewIfNeeded();
      await audit(S.page, `${locale}/admin-community`);
      await shot(S.page, `${locale}/admin-32-community-profile`);
      const info = (await (
        await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/v1/instance`)
      ).json()) as { community: { faith: boolean; intentions: string[] } };
      check(
        info.community.faith && info.community.intentions.includes('marriage'),
        'the admin turns the faith module on; marriage is offered',
      );
    } finally {
      await S.context.close();
    }

    // ------------------------------------------------------------ member: faith in the app
    const tamar = await onboardMember(`faith-${locale}`, herName, 'woman', ['man']);
    const yoni = await onboardMember(`faith-${locale}`, hisName, 'man', ['woman']);
    await tamar.call('PATCH', '/v1/me/profile', { intention: 'marriage' });
    const M = await open(browser, locale, tamar.session);
    try {
      await M.page.goto(`${WEB}/edit-faith`);
      await M.page.getByRole('checkbox', { name: t.about.religionConsent }).click();
      await M.page.getByRole('radio', { name: t.faith.faiths.jewish, exact: true }).click();
      await M.page.getByRole('radio', { name: t.faith.streams.dati_leumi }).click();
      await M.page
        .getByRole('radiogroup', { name: t.faith.questions.shabbat })
        .getByRole('radio', { name: t.faith.answers.yes })
        .click();
      await audit(M.page, `${locale}/faith-edit`);
      await shot(M.page, `${locale}/145-faith-edit`);
      await M.page.getByRole('button', { name: t.common.save }).click();
      let saved: { faith: { faith: string | null; stream: string | null } } | undefined;
      for (let i = 0; i < 40; i += 1) {
        saved = await tamar.call('GET', '/v1/me');
        if (saved?.faith.stream) break;
        await M.page.waitForTimeout(250);
      }
      check(
        saved?.faith.faith === 'jewish' && saved.faith.stream === 'dati_leumi',
        'the member gives consent and answers faith, stream and Shabbat',
      );
    } finally {
      await M.context.close();
    }

    // ------------------------------------------------------------ another member sees it
    const Y = await open(browser, locale, yoni.session);
    try {
      await Y.page.goto(`${WEB}/profile/${tamar.id}`);
      const line = Y.page.getByTestId('faith');
      await line.waitFor({ timeout: 20_000 });
      const text = await line.innerText();
      check(
        text.includes(t.faith.streams.dati_leumi) && text.includes(t.faith.questions.shabbat),
        `the card shows faith and observance (“${text}”)`,
      );
      check(
        (await Y.page.getByText(t.intention.marriage).count()) > 0,
        'and the intention “Marriage”',
      );
      await audit(Y.page, `${locale}/faith-card`);
      await shot(Y.page, `${locale}/146-faith-card`);
    } finally {
      await Y.context.close();
    }

    // ------------------------------------------------------------ a stream dealbreaker
    await yoni.call('PUT', '/v1/me/consents', {
      consents: [{ kind: 'religion', granted: true, version: '1' }],
    });
    const base = {
      smokingOk: [],
      childrenOk: [],
      religionOk: [],
      heightMin: null,
      heightMax: null,
    };
    await yoni.call('PUT', '/v1/me/dealbreakers', { ...base, streamOk: ['haredi'] });
    const deck = await yoni.call<{ profiles: { id: string }[] }>('GET', '/v1/discover?limit=20');
    check(!deck.profiles.some((p) => p.id === tamar.id), 'a stream dealbreaker hides a mismatch');
    await boss.call('PATCH', '/v1/admin/instance', { faithModule: false });
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
process.stdout.write('\nFaith module and marriage: OK\n');
