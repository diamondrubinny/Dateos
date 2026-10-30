// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 62a end to end: an admin lets members use their own words (Dashboard → Branding →
 * Identity); a member describes themself and how to address them, for matches only; a stranger
 * doesn't see it, a match does, on the profile card.
 * Usage: pnpm --dir e2e identity (API, web app and dashboard running)
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
const STORY: Record<L, { names: [string, string, string]; words: string }> = {
  en: { names: ['Noa', 'Dan', 'Eli'], words: 'Femme' },
  he: { names: ['נועה', 'דן', 'אלי'], words: 'קווירית' },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession(tag: string) {
  const email = `identity-admin-${tag}-${Date.now()}@example.test`;
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
    const story = STORY[locale];
    const [noaName, danName, eliName] = story.names;

    // ------------------------------------------------------------ admin: allow own words
    const boss = await adminSession(locale);
    await boss.call('PATCH', '/v1/admin/instance', { identityCustom: false });
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/branding`);
      const card = S.page.locator('form', {
        has: S.page.getByRole('heading', { name: a.branding.identityTitle }),
      });
      await card.waitFor();
      await card.getByLabel(a.branding.identityCustom).check();
      await card.getByRole('button', { name: a.branding.identitySave }).click();
      await S.page.getByText(a.branding.identitySaved).waitFor();
      await card.scrollIntoViewIfNeeded();
      await audit(S.page, `${locale}/admin-identity`);
      await shot(S.page, `${locale}/admin-31-identity`);
      const info = (await (
        await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/v1/instance`)
      ).json()) as {
        identity: { customGender: boolean };
      };
      check(info.identity.customGender, 'the admin turns on "own words" in the dashboard');
    } finally {
      await S.context.close();
    }

    // ------------------------------------------------------------ member: describe themself
    const noa = await onboardMember(`identity-${locale}`, noaName, 'woman', ['man']);
    const dan = await onboardMember(`identity-${locale}`, danName, 'man', ['woman']);
    const eli = await onboardMember(`identity-${locale}`, eliName, 'man', ['woman']);
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/edit-identity`);
      await N.page.getByRole('radio', { name: t.identity.own }).click();
      await N.page.getByRole('textbox', { name: t.identity.ownLabel }).fill(story.words);
      await N.page.getByRole('radio', { name: t.identity.forms.feminine }).click();
      await audit(N.page, `${locale}/identity-edit`);
      await shot(N.page, `${locale}/143-identity-edit`);
      await N.page.getByRole('button', { name: t.common.save }).click();
      let saved: { identity: { genderCustom: string | null; visibility: string } } | undefined;
      for (let i = 0; i < 40; i += 1) {
        saved = await noa.call('GET', '/v1/me');
        if (saved?.identity.genderCustom) break;
        await N.page.waitForTimeout(250);
      }
      check(
        saved?.identity.genderCustom === story.words && saved.identity.visibility === 'matches',
        'the member saves their own words and a form of address, for matches only (the default)',
      );
    } finally {
      await N.context.close();
    }

    // ------------------------------------------------------------ a stranger, then a match
    const stranger = await eli.call<{ identity?: unknown }>('GET', `/v1/profiles/${noa.id}`);
    check(!stranger.identity, 'a stranger doesn’t see it');
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await noa.call('POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/profile/${noa.id}`);
      const line = D.page.getByTestId('identity');
      await line.waitFor({ timeout: 20_000 });
      const text = await line.innerText();
      check(
        text.includes(story.words) && text.includes(t.identity.forms.feminine),
        `a match sees it on the card (“${text}”)`,
      );
      await audit(D.page, `${locale}/identity-card`);
      await shot(D.page, `${locale}/144-identity-card`);
    } finally {
      await D.context.close();
    }
    await boss.call('PATCH', '/v1/admin/instance', { identityCustom: false });
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
process.stdout.write('\nGender identity and pronouns: OK\n');
