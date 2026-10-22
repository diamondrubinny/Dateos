// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Who sees me (phase 18), end to end in every language: take a break from Settings, see the calm
 * "You're taking a break" card instead of Discover, Picks and Likes, then come back; turn incognito
 * on and off.
 * Usage: pnpm --dir e2e visibility
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { demoPhoto } from './demo-images.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { apiClient, LOCALE_TAGS, locales, reportA11y, shot, signInHttp, WEB } from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, string> = { en: 'Maya', he: 'מאיה', ar: 'ليلى', ru: 'Маша' };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

/** A member with a finished profile, so the app doesn't send them back to onboarding. */
async function member(
  locale: L,
  who: {
    name?: string;
    gender?: 'woman' | 'man';
    interestedIn?: string[];
    at?: { lat: number; lng: number };
  } = {},
) {
  const session = await signInHttp(`visibility-${locale}-${Date.now()}@example.test`);
  const call = apiClient(session.header);
  await call('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: '2026-10' },
      { kind: 'privacy', granted: true, version: '2026-10' },
      { kind: 'sensitive', granted: true, version: '1' },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  await call('POST', '/v1/me/profile', {
    displayName: who.name ?? NAMES[locale],
    birthDate: '1994-04-04',
    gender: who.gender ?? 'woman',
    interestedIn: who.interestedIn ?? ['man'],
    intention: 'long_term',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/location', who.at ?? { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: 'Coffee by the sea, then a long walk.' }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto('sunset'))], { type: 'image/jpeg' }),
    'me.jpg',
  );
  await call('POST', '/v1/me/photos', form);
  for (let i = 0; i < 60; i += 1) {
    const me = await call<{ photos: { status: string }[] }>('GET', '/v1/me');
    if (me.photos[0]?.status === 'clean')
      return { session, call, id: (me as unknown as { user: { id: string } }).user.id };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('photo was not processed');
}

async function open(browser: Browser, session: { name: string; value: string }, locale: L) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
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

const HAIFA: Record<L, string> = { en: 'Haifa', he: 'חיפה', ar: 'حيفا', ru: 'Хайфа' };
const HOSTS: Record<L, string> = { en: 'Dan', he: 'דן', ar: 'سامي', ru: 'Дима' };

async function travel(browser: Browser, locale: L) {
  const t = T[locale];
  const traveller = await member(locale);
  // Someone who lives in Haifa, about 80 km away.
  const host = await member(locale, {
    name: HOSTS[locale],
    gender: 'man',
    interestedIn: ['woman'],
    at: { lat: 32.794, lng: 34.9896 },
  });
  const A = await open(browser, traveller.session, locale);
  try {
    await A.page.goto(`${WEB}/settings`);
    const section = A.page.getByTestId('travel-mode');
    await section.scrollIntoViewIfNeeded();
    await section.getByLabel(t.travel.search).fill(HAIFA[locale]);
    const city = section.getByRole('radio', { name: new RegExp(`^${HAIFA[locale]}`) }).first();
    await city.waitFor();
    check(
      await section.getByText(t.travel.found.replace('{{count}}', '')).first().isVisible(),
      'the number of cities found is announced',
    );
    await city.click();
    await section.getByRole('radio', { name: t.travel.duration[7], exact: true }).click();
    await shot(A.page, `${locale}/64-travel-mode`);
    await section
      .getByRole('button', { name: t.travel.startIn.replace('{{city}}', HAIFA[locale]) })
      .click();
    await section.getByRole('button', { name: t.travel.end }).waitFor();
    const trip = await traveller.call<{ travel: { names: { en: string } } | null }>(
      'GET',
      '/v1/me/travel',
    );
    check(trip.travel?.names.en === 'Haifa', 'travelling to Haifa for a week');
    await A.page.goto(`${WEB}/discover`);
    await A.page.getByText(t.travel.active.split('{{city}}')[0]!.trim()).first().waitFor();
    await shot(A.page, `${locale}/65-travel-discover`);
  } finally {
    await A.context.close();
  }
  // The host in Haifa sees the traveller, honestly marked as visiting.
  const B = await open(browser, host.session, locale);
  try {
    await B.page.goto(`${WEB}/profile/${traveller.id}`);
    const badge = B.page.getByTestId('visiting');
    await badge.waitFor();
    check(
      (await badge.innerText()).includes(t.travel.visiting.replace('{{city}}', HAIFA[locale])),
      'the profile says "Visiting Haifa", not a distance',
    );
    await shot(B.page, `${locale}/66-visiting`);
  } finally {
    await B.context.close();
  }
  await traveller.call('DELETE', '/v1/me/travel');
}

async function incognito(browser: Browser, locale: L) {
  const t = T[locale];
  const { session, call } = await member(locale);
  const { context, page } = await open(browser, session, locale);
  try {
    await page.goto(`${WEB}/settings`);
    const box = page.getByRole('checkbox', { name: t.visibility.incognitoLabel });
    await box.scrollIntoViewIfNeeded();
    check((await box.getAttribute('aria-checked')) === 'false', 'incognito is off by default');
    await box.click();
    await page.waitForFunction(
      (label) =>
        document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-checked') === 'true',
      t.visibility.incognitoLabel,
    );
    const me = await call<{ incognito: boolean }>('GET', '/v1/me');
    check(me.incognito, 'incognito is saved');
    await page.getByText(t.visibility.title).scrollIntoViewIfNeeded();
    await shot(page, `${locale}/63-incognito`);
    await box.click();
    await page.waitForFunction(
      (label) =>
        document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-checked') === 'false',
      t.visibility.incognitoLabel,
    );
    check(!(await call<{ incognito: boolean }>('GET', '/v1/me')).incognito, 'and turned off again');
  } finally {
    await context.close();
  }
}

async function takeABreak(browser: Browser, locale: L) {
  const t = T[locale];
  const { session, call } = await member(locale);
  const { context, page } = await open(browser, session, locale);
  try {
    await page.goto(`${WEB}/settings`);
    const section = page.getByTestId('take-a-break');
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('radio', { name: t.pause.duration['7d'] }).click();
    await shot(page, `${locale}/61-take-a-break`);
    await section.getByRole('button', { name: t.pause.start }).click();
    await section.getByRole('button', { name: t.pause.comeBack }).waitFor();
    const me = await call<{ pause: { since: string; until: string | null } | null }>(
      'GET',
      '/v1/me',
    );
    const days = me.pause?.until
      ? (Date.parse(me.pause.until) - Date.parse(me.pause.since)) / 86_400_000
      : 0;
    check(days === 7, 'a week-long break is saved');

    for (const tab of ['discover', 'picks', 'likes']) {
      await page.goto(`${WEB}/${tab}`);
      await page.getByTestId('on-break').waitFor();
      check(
        await page.getByText(t.pause.onBreakBody).isVisible(),
        `${tab}: the calm "taking a break" card instead of profiles`,
      );
    }
    await page.goto(`${WEB}/discover`);
    await page.getByTestId('on-break').waitFor();
    await shot(page, `${locale}/62-on-break`);

    await page.getByRole('button', { name: t.pause.comeBack }).click();
    await page.getByTestId('on-break').waitFor({ state: 'detached' });
    const after = await call<{ pause: unknown }>('GET', '/v1/me');
    check(after.pause === null, '"Come back now" ends the break');
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    // Each language signs a new member in; the per-IP sign-in limit is real, so clear it locally.
    await pool.query('DELETE FROM rate_limit');
    await takeABreak(browser, locale);
    await pool.query('DELETE FROM rate_limit');
    await incognito(browser, locale);
    await pool.query('DELETE FROM rate_limit');
    await travel(browser, locale);
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
