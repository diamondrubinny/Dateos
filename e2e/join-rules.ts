// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 62c end to end: an admin applies the "50+" preset and adds a declaration (Dashboard →
 * Branding); a new member sees the community's rules in onboarding, is refused at 30 with a plain
 * explanation, then joins at 56 after confirming the declaration.
 * Usage: pnpm --dir e2e join-rules (API, web app and dashboard running)
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
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he } as const;
type L = keyof typeof T;
const STORY: Record<L, { name: string; declaration: string }> = {
  en: { name: 'Ruth', declaration: 'I am single and looking for a serious relationship.' },
  he: { name: 'רות', declaration: 'אני פנוי/ה ומחפש/ת קשר רציני.' },
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
  const email = `join-admin-${tag}-${Date.now()}@example.test`;
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
const LEGAL = { terms: '2026-10', privacy: '2026-10' };
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale];
    const story = STORY[locale];

    // ------------------------------------------------------------ admin: preset + declaration
    const boss = await adminSession(locale);
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/branding`);
      const presets = S.page.locator('form', {
        has: S.page.getByRole('heading', { name: a.branding.presetsTitle }),
      });
      await presets.waitFor();
      await presets.getByLabel(a.branding.presets.fiftyPlus.name, { exact: true }).check();
      await presets.getByRole('button', { name: a.branding.presetApply }).click();
      await S.page.getByText(a.branding.presetApplied).waitFor();
      const join = S.page.locator('form', {
        has: S.page.getByRole('heading', { name: a.branding.joinTitle }),
      });
      let minAge = '';
      for (let i = 0; i < 40 && minAge !== '50'; i += 1) {
        minAge = await join.getByLabel(a.branding.joinMinAge).inputValue();
        if (minAge !== '50') await S.page.waitForTimeout(250);
      }
      check(minAge === '50', 'the "50+" preset sets the minimum age in the card below');
      await join.getByLabel(a.branding.joinDeclaration).fill(story.declaration);
      await join.getByRole('button', { name: a.branding.joinSave }).click();
      await S.page.getByText(a.branding.joinSaved).waitFor();
      await join.scrollIntoViewIfNeeded();
      await audit(S.page, `${locale}/admin-join`);
      await shot(S.page, `${locale}/admin-33-who-may-join`);
    } finally {
      await S.context.close();
    }

    // ------------------------------------------------------------ a new member in onboarding
    const email = `join-${locale}-${Date.now()}@example.test`;
    const session = await signInHttp(email);
    const call = apiClient(session.header);
    await call('PUT', '/v1/me/consents', {
      consents: [
        { kind: 'terms', granted: true, version: LEGAL.terms },
        { kind: 'privacy', granted: true, version: LEGAL.privacy },
        { kind: 'sensitive', granted: true, version: '1' },
      ],
    });
    const M = await open(browser, locale, session);
    try {
      await M.page.goto(`${WEB}/onboarding/profile`);
      const rules = M.page.getByTestId('join-rules');
      await rules.waitFor();
      check(
        (await rules.innerText()).includes(t.join.ageFrom.replace('{{min}}', '50')),
        'onboarding says the community is for 50 and over',
      );
      check(
        (await M.page.getByTestId('join-declaration').innerText()).includes(story.declaration),
        'and shows the declaration',
      );
      await M.page.getByLabel(t.onboarding.profile.name).fill(story.name);
      await M.page.getByLabel(t.onboarding.profile.day).fill('5');
      await M.page.getByLabel(t.onboarding.profile.month).fill('5');
      await M.page.getByLabel(t.onboarding.profile.year).fill('1996');
      await M.page
        .getByRole('radiogroup', { name: t.onboarding.profile.gender })
        .getByRole('radio', { name: t.gender.woman, exact: true })
        .click();
      await M.page
        .getByRole('group', { name: t.onboarding.profile.interestedIn })
        .getByRole('checkbox', { name: t.gender.man, exact: true })
        .click();
      await M.page
        .getByRole('radiogroup', { name: t.onboarding.profile.intention })
        .getByRole('radio', { name: t.intention.long_term })
        .click();
      await M.page.getByRole('button', { name: t.common.continue }).click();
      await M.page.getByText(t.join.declarationRequired).waitFor();
      check(true, 'the declaration must be confirmed');
      await M.page.getByRole('checkbox', { name: t.join.declarationConfirm }).click();
      await M.page.getByRole('button', { name: t.common.continue }).click();
      await M.page.getByText(t.join.notEligible).waitFor();
      check(true, 'at 30 the profile is refused, with a plain explanation (no suspension)');
      await M.page.getByTestId('join-rules').scrollIntoViewIfNeeded();
      await M.page.getByText(t.join.notEligible).scrollIntoViewIfNeeded();
      await audit(M.page, `${locale}/join-refused`);
      await shot(M.page, `${locale}/147-join-rules`);
      await M.page.getByLabel(t.onboarding.profile.year).fill('1970');
      await M.page.getByRole('button', { name: t.common.continue }).click();
      await M.page.waitForURL((url) => url.pathname.endsWith('/onboarding/photos'), {
        timeout: 20_000,
      });
      const { rows } = await pool.query(
        `SELECT p.declaration_accepted_at IS NOT NULL AS declared, u.status FROM profiles p
         JOIN "user" u ON u.id = p.user_id WHERE u.email = $1`,
        [email],
      );
      check(
        rows[0]?.declared === true && rows[0]?.status === 'active',
        'at 56, with the declaration confirmed, the profile is created',
      );
    } finally {
      await M.context.close();
    }
    await boss.call('PATCH', '/v1/admin/instance', {
      joinMinAge: 18,
      joinMaxAge: null,
      joinGenders: [],
      joinDeclaration: null,
      intentionsOffered: ['long_term', 'marriage', 'short_term', 'open', 'friends', 'unsure'],
    });
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
process.stdout.write('\nWho may join: OK\n');
