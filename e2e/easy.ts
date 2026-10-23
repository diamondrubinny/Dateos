// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Easy mode and accessibility needs (phase 25) end to end, in every language:
 * - The welcome page offers "Bigger text and a simpler app"; the choice stays in this browser.
 * - Display and ease of use: text size, easy mode, contrast, motion.
 * - Easy mode: three tabs, Picks and Likes as buttons, a plain explanation under Like and Pass,
 *   folded options on the Me tab.
 * - Accessibility needs: consent, choices, "show on my profile"; another member sees the line;
 *   the date planner puts step-free places first.
 * Usage: pnpm --dir e2e easy
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
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
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = {
  en: ['Maya', 'Dan'],
  he: ['מאיה', 'דן'],
  ar: ['ليلى', 'سامي'],
  ru: ['Маша', 'Дима'],
};
const EASY = JSON.stringify({ textSize: 'large', easy: true, contrast: false, reduceMotion: true });

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string } | null,
  display: string | null,
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
  });
  if (session) {
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
  }
  await context.addInitScript(
    ([l, d]) => {
      localStorage.setItem('nexaheart.locale', l!);
      if (d) localStorage.setItem('nexaheart.display', d);
    },
    [locale, display] as const,
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

type Pool = ReturnType<typeof createDb>['pool'];
/** Step-free and other places for the date planner, created by an admin. */
async function venues(pool: Pool) {
  const email = `easy-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  const existing = await call<{ venues: { name: string }[] }>('GET', '/v1/admin/venues');
  const wanted = [
    { name: 'Cafe Up the Stairs', area: 'Jaffa', category: 'cafe', stepFree: false },
    { name: 'Garden Cafe', area: 'Tel Aviv', category: 'cafe', stepFree: true },
  ];
  for (const v of wanted) {
    if (existing.venues.some((e) => e.name === v.name)) continue;
    await call('POST', '/v1/admin/venues', { ...v, address: '1 Example St', note: null });
  }
}

async function welcome(browser: Browser, locale: L) {
  const t = T[locale];
  const S = await open(browser, locale, null, null);
  try {
    await S.page.goto(`${WEB}/welcome`);
    const box = S.page.getByRole('checkbox', { name: t.display.welcomeLabel });
    await box.click();
    const stored = await S.page.evaluate(() => localStorage.getItem('nexaheart.display'));
    check(
      stored !== null &&
        JSON.parse(stored).easy === true &&
        JSON.parse(stored).textSize === 'large',
      'the welcome choice turns on easy mode and large text, in this browser only',
    );
    await shot(S.page, `${locale}/93-welcome-easy`);
    await S.page.goto(`${WEB}/display`);
    await S.page.getByRole('heading', { name: t.display.title }).first().waitFor();
    await S.page.getByRole('radio', { name: t.display.sizes.larger }).click();
    await S.page.getByRole('checkbox', { name: t.display.contrastLabel }).click();
    await shot(S.page, `${locale}/94-display`);
    const after = JSON.parse(
      (await S.page.evaluate(() => localStorage.getItem('nexaheart.display'))) ?? '{}',
    );
    check(after.textSize === 'larger' && after.contrast === true, 'display choices are kept');
  } finally {
    await S.context.close();
  }
}

async function easyApp(browser: Browser, locale: L) {
  const t = T[locale];
  const [aName, bName] = NAMES[locale];
  const a = await onboardMember(`easy-${locale}`, aName, 'woman', ['man']);
  const b = await onboardMember(`easy-${locale}`, bName, 'man', ['woman']);

  // Easy mode on A's phone.
  const A = await open(browser, locale, a.session, EASY);
  try {
    await A.page.goto(`${WEB}/discover`);
    await A.page
      .getByRole('button', { name: new RegExp(t.tabs.picks) })
      .first()
      .waitFor();
    check(
      (await A.page.getByRole('tab').count()) === 3 &&
        (await A.page.getByRole('tab', { name: t.tabs.picks }).count()) === 0,
      'easy mode shows three tabs (Picks and Likes are buttons on Discover)',
    );
    await shot(A.page, `${locale}/95-discover-easy`);
    await A.page.goto(`${WEB}/profile`);
    const more = A.page.getByRole('button', { name: t.display.moreOptions });
    await more.waitFor();
    check(await more.isVisible(), 'the Me tab folds the less-used options');
    check(
      (await A.page.getByRole('button', { name: t.home.editAbout }).count()) === 0,
      'folded options start hidden',
    );

    // Accessibility needs, with consent, shown on the profile.
    await A.page.goto(`${WEB}/access-needs`);
    await A.page.getByRole('checkbox', { name: t.access.consent }).click();
    await A.page.getByRole('checkbox', { name: t.access.needs.wheelchair }).click();
    await A.page.getByRole('checkbox', { name: t.access.needs.text_first }).click();
    await A.page.getByRole('checkbox', { name: t.access.show }).click();
    await shot(A.page, `${locale}/96-access-needs`);
    await A.page.getByRole('button', { name: t.common.save }).click();
    await A.page.getByText(t.access.saved).waitFor();
    const me = await a.call<{ accessNeeds: { needs: string[]; show: boolean } }>('GET', '/v1/me');
    check(
      me.accessNeeds.show && me.accessNeeds.needs.join() === 'wheelchair,text_first',
      'the needs are saved with "show on my profile"',
    );
  } finally {
    await A.context.close();
  }

  // B sees the line on A's profile, and the date planner puts step-free places first.
  await a.call('POST', '/v1/interactions', { targetId: b.id, kind: 'like' });
  const { matchId } = await b.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: a.id,
    kind: 'like',
  });
  const B = await open(browser, locale, b.session, null);
  try {
    await B.page.goto(`${WEB}/profile/${a.id}?matchId=${matchId}`);
    const line = B.page.getByTestId('access-needs');
    await line.waitFor();
    const text = (await line.textContent()) ?? '';
    check(
      text.includes(t.access.short.wheelchair) && text.includes(t.access.short.text_first),
      'another member sees the needs A chose to show',
    );
    await line.scrollIntoViewIfNeeded();
    await shot(B.page, `${locale}/97-profile-access-needs`);
    await B.page.goto(`${WEB}/date/${matchId}?name=${encodeURIComponent(aName)}`);
    const onlyStepFree = B.page.getByRole('checkbox', { name: t.access.stepFreeOnly });
    await onlyStepFree.waitFor();
    check(
      (await onlyStepFree.getAttribute('aria-checked')) === 'true',
      'the date planner starts with step-free places only, for the other person’s needs',
    );
    check(
      (await B.page.getByRole('radio', { name: /Cafe Up the Stairs/ }).count()) === 0,
      'a place with stairs is not offered',
    );
    await shot(B.page, `${locale}/98-date-step-free`);
  } finally {
    await B.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 2 });
try {
  await pool.query('DELETE FROM rate_limit');
  await resetRouteLimits();
  await venues(pool);
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await pool.query('DELETE FROM rate_limit');
    await welcome(browser, locale);
    await easyApp(browser, locale);
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
process.stdout.write(
  problems.length ? `\n${problems.length} problem(s)\n` : '\nall checks passed\n',
);
if (problems.length) process.exitCode = 1;
