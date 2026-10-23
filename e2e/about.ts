// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Profile depth (phase 19) end to end in every language: fill in About me (interests, lifestyle,
 * an opening question) and record a voice prompt with a (fake) microphone; another member sees the
 * chips with shared interests marked, the question and the voice prompt; dealbreakers hide a
 * smoker in both directions.
 * Usage: pnpm --dir e2e about
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

let emailCounter = 0;
async function member(locale: L, name: string, gender: 'woman' | 'man', interestedIn: string[]) {
  // Names can be in any script; email addresses stay ASCII.
  emailCounter += 1;
  const session = await signInHttp(
    `about-${locale}-${gender}-${emailCounter}-${Date.now()}@example.test`,
  );
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
    displayName: name,
    birthDate: '1994-04-04',
    gender,
    interestedIn,
    intention: 'long_term',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/preferences', {
    ageMin: 18,
    ageMax: 99,
    maxDistanceKm: 50,
    intentions: [],
  });
  await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: 'Coffee by the sea, then a long walk.' }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto(gender === 'woman' ? 'sunset' : 'mountain'))], {
      type: 'image/jpeg',
    }),
    'me.jpg',
  );
  await call('POST', '/v1/me/photos', form);
  for (let i = 0; i < 60; i += 1) {
    const me = await call<{ user: { id: string }; photos: { status: string }[] }>('GET', '/v1/me');
    if (me.photos[0]?.status === 'clean') return { session, call, id: me.user.id };
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
    permissions: ['microphone'],
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
  const [her, him] = NAMES[locale];
  const maya = await member(locale, her, 'woman', ['man']);
  const dan = await member(locale, him, 'man', ['woman']);
  await dan.call('PUT', '/v1/me/about', {
    interests: ['hiking', 'coffee', 'cinema'],
    children: null,
    smoking: 'no',
    drinking: null,
    heightCm: 182,
    religion: null,
    openingQuestion: null,
  });

  // 1. Maya fills in About me in the app, and records a voice prompt.
  const A = await open(browser, maya.session, locale);
  try {
    await A.page.goto(`${WEB}/edit-about`);
    for (const key of ['hiking', 'coffee', 'board_games'] as const) {
      await A.page.getByRole('checkbox', { name: t.interest[key], exact: true }).click();
    }
    await A.page.getByRole('radio', { name: t.about.childrenOptions.want, exact: true }).click();
    await A.page
      .getByRole('radiogroup', { name: t.about.smoking })
      .getByRole('radio', { name: t.about.smokingOptions.no, exact: true })
      .click();
    await A.page.getByLabel(t.about.height).fill('168');
    await A.page.getByRole('button', { name: t.about.suggestion.best_trip }).click();
    await shot(A.page, `${locale}/67-about-edit`);

    const voice = A.page.getByTestId('voice-prompt');
    await voice.scrollIntoViewIfNeeded();
    await voice.getByRole('button', { name: t.voicePrompt.record }).click();
    await voice.getByRole('button', { name: t.voice.start }).click();
    await A.page.waitForTimeout(2500);
    await voice.getByRole('button', { name: t.voice.stop }).click();
    await voice.getByRole('button', { name: t.voicePrompt.save }).click();
    // The worker scans and re-encodes it; the player appears once it's clean.
    await voice
      .getByRole('button', { name: t.voice.play.split('{{')[0]!.trim() })
      .waitFor({ timeout: 60_000 });
    check(true, 'the voice prompt was recorded, checked and can be played');

    await A.page.getByRole('button', { name: t.common.save }).click();
    await A.page.waitForURL((url) => !url.pathname.endsWith('/edit-about'));
    const me = await maya.call<{ about: { interests: string[]; heightCm: number } }>(
      'GET',
      '/v1/me',
    );
    check(
      me.about.heightCm === 168 && me.about.interests.length === 3,
      'about me is saved (3 interests, 168 cm)',
    );

    // Dealbreakers: no smokers.
    await A.page.goto(`${WEB}/dealbreakers`);
    await A.page
      .getByRole('checkbox', { name: t.about.smokingOptions.no, exact: true })
      .first()
      .click();
    await shot(A.page, `${locale}/69-dealbreakers`);
    await A.page.getByRole('button', { name: t.common.save }).click();
    await A.page.waitForURL((url) => !url.pathname.endsWith('/dealbreakers'));
    const deal = await maya.call<{ dealbreakers: { smokingOk: string[] } }>('GET', '/v1/me');
    check(deal.dealbreakers.smokingOk.join() === 'no', 'dealbreaker saved: no smokers');
  } finally {
    await A.context.close();
  }

  // 2. Dan sees her profile: lifestyle chips, shared interests marked, the question, her voice.
  const B = await open(browser, dan.session, locale);
  try {
    await B.page.goto(`${WEB}/profile/${maya.id}`);
    const about = B.page.getByTestId('about-section');
    await about.waitFor();
    const text = await about.innerText();
    check(text.includes(`✓ ${t.interest.hiking}`), 'shared interests are marked with ✓');
    check(text.includes(t.interest.board_games), 'her other interests are shown');
    check(text.includes(t.about.suggestion.best_trip), 'her opening question is shown');
    await B.page.getByTestId('profile-voice-prompt').waitFor();
    await about.scrollIntoViewIfNeeded();
    await shot(B.page, `${locale}/68-about-profile`);
  } finally {
    await B.context.close();
  }

  // 3. A smoker is hidden both ways.
  const smoker = await member(locale, `${him}2`, 'man', ['woman']);
  await smoker.call('PUT', '/v1/me/about', {
    interests: [],
    children: null,
    smoking: 'yes',
    drinking: null,
    heightCm: null,
    religion: null,
    openingQuestion: null,
  });
  const feed = await smoker.call<{ profiles: { id: string }[] }>('GET', '/v1/discover?limit=20');
  check(!feed.profiles.some((p) => p.id === maya.id), 'the smoker does not see her');
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await pool.query('DELETE FROM rate_limit');
    await run(browser, locale);
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
