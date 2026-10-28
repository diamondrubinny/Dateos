// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 34 end to end: "Verified profiles only" in Preferences keeps unverified people out of
 * Discover; liking faster than a person reads profiles shows a calm "slow down" message.
 * Usage: pnpm --dir e2e anti-bot
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = {
  en: ['Maya', 'Dan'],
  he: ['מאיה', 'דן'],
  ar: ['ليلى', 'سامي'],
  ru: ['Маша', 'Дима'],
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function open(browser: Browser, locale: L, member: OnboardedMember) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  const { name, value } = member.session;
  await context.addCookies([
    { name, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [herName, hisName] = NAMES[locale];
    const maya = await onboardMember(`antibot-${locale}`, herName, 'woman', ['man']);
    const verified = await onboardMember(`antibot-${locale}`, `${hisName} ✓`, 'man', ['woman']);
    await pool.query('UPDATE profiles SET verified_at = now() WHERE user_id = $1', [verified.id]);
    const A = await open(browser, locale, maya);

    // 1. Verified profiles only.
    await A.page.goto(`${WEB}/preferences`);
    const box = A.page.getByRole('checkbox', { name: `✓ ${t.preferences.verifiedOnly}` });
    await box.waitFor();
    await box.click();
    await audit(A.page, `${locale}/verified-only`);
    await shot(A.page, `${locale}/105-verified-only`);
    await A.page.getByRole('button', { name: t.common.save }).click();
    await A.page.getByText(t.preferences.saved).waitFor();
    const deck = await maya.call<{ profiles: { id: string; verified: boolean }[] }>(
      'GET',
      '/v1/discover',
    );
    check(deck.profiles.length > 0, `Discover still has people (${deck.profiles.length})`);
    check(
      deck.profiles.every((p) => p.verified),
      'everyone in Discover is verified',
    );
    check(
      deck.profiles.some((p) => p.id === verified.id),
      'the verified member is there',
    );

    // 2. Liking too fast: 40 recent likes, then the next one asks to slow down.
    for (let i = 0; i < 40; i += 1) {
      const id = `antibot-fill-${locale}-${Date.now()}-${i}`;
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $1, $1 || '@example.test', true, now(), now())`,
        [id],
      );
      await pool.query(
        `INSERT INTO interactions (actor_id, target_id, kind) VALUES ($1, $2, 'like')`,
        [maya.id, id],
      );
    }
    await A.page.goto(`${WEB}/discover`);
    const like = A.page.getByRole('button', { name: `♥ ${t.discover.like}`, exact: true });
    await like.waitFor();
    await like.click();
    await A.page.getByText(t.discover.slowDown).waitFor();
    check(true, 'a calm "slow down" message');
    await audit(A.page, `${locale}/slow-down`);
    await A.context.close();
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
process.stdout.write('\nAnti-bot: OK\n');
