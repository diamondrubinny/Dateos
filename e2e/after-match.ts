// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * After the match (phase 20) end to end in every language: both share free times and see only the
 * overlap, which opens the date planner filled in; after the date each answers "did you meet?"
 * privately and both see "you both want to meet again"; the met-in-person badge appears once
 * turned on; with six people waiting, Discover asks for replies first.
 * Usage: pnpm --dir e2e after-match
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser, type Page } from 'playwright';
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
const TZ = 'Asia/Jerusalem';

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

/** "YYYY-MM-DD" of the day `offset` days from today, in the browser's time zone. */
const localDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

let emailCounter = 0;
async function member(locale: L, name: string, gender: 'woman' | 'man', interestedIn: string[]) {
  emailCounter += 1;
  const session = await signInHttp(
    `after-${locale}-${gender}-${emailCounter}-${Date.now()}@example.test`,
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
    birthDate: '1993-03-03',
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
type M = Awaited<ReturnType<typeof member>>;

async function match(a: M, b: M): Promise<string> {
  await a.call('POST', '/v1/interactions', { targetId: b.id, kind: 'like' });
  const res = await b.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: a.id,
    kind: 'like',
  });
  return res.matchId;
}

async function open(browser: Browser, session: { name: string; value: string }, locale: L) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: TZ,
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

const checked = async (page: Page, role: 'radio' | 'checkbox', name: string) =>
  (await page.getByRole(role, { name, exact: true }).first().getAttribute('aria-checked')) ===
  'true';

async function run(browser: Browser, locale: L) {
  const t = T[locale];
  const [her, him] = NAMES[locale];
  const maya = await member(locale, her, 'woman', ['man']);
  const dan = await member(locale, him, 'man', ['woman']);
  const matchId = await match(dan, maya);
  const venueName = `Café Puaa ${locale} ${Date.now() % 100000}`;
  await pool.query(
    `INSERT INTO venues (name, area, category, address, step_free) VALUES ($1, 'Jaffa', 'cafe', 'Rabbi Yohanan St 8', true)`,
    [venueName],
  );

  const A = await open(browser, maya.session, locale);
  try {
    // 1. Maya marks her free times; Dan shares his over the API.
    await A.page.goto(`${WEB}/free/${matchId}?name=${encodeURIComponent(him)}`);
    const groups = A.page.getByRole('group');
    await groups.first().waitFor();
    await groups.nth(2).getByRole('checkbox', { name: t.free.parts.evening, exact: true }).click();
    await groups.nth(3).getByRole('checkbox', { name: t.free.parts.morning, exact: true }).click();
    await groups.nth(4).getByRole('checkbox', { name: t.free.parts.evening, exact: true }).click();
    await shot(A.page, `${locale}/70-free-times`);
    await A.page.getByRole('button', { name: t.common.save }).click();
    await A.page.waitForURL((url) => !url.pathname.startsWith('/free'));
    await dan.call('PUT', `/v1/matches/${matchId}/availability`, {
      slots: [`${localDay(2)}:evening`, `${localDay(4)}:evening`, `${localDay(5)}:morning`],
    });
    const danView = await dan.call<{ overlap: string[] }>(
      'GET',
      `/v1/matches/${matchId}/availability`,
    );
    check(
      danView.overlap.join() === `${localDay(2)}:evening,${localDay(4)}:evening` &&
        !JSON.stringify(danView).includes(`${localDay(3)}:morning`),
      'Dan sees only the overlap, not her other times',
    );

    // 2. Her chat shows the overlap; a time opens the planner with day and hour filled in.
    await A.page.goto(`${WEB}/chat/${matchId}`);
    const free = A.page.getByTestId('free-times');
    await free.getByText(t.free.overlap).first().waitFor();
    const chips = free.getByRole('button', { name: new RegExp(t.free.parts.evening) });
    check((await chips.count()) === 2, 'her chat shows the two shared times');
    await shot(A.page, `${locale}/71-free-overlap`);
    await chips.first().click();
    await A.page.waitForURL((url) => url.pathname.startsWith('/date/'));
    await A.page.getByRole('radio', { name: '19:00', exact: true }).waitFor();
    check(await checked(A.page, 'radio', '19:00'), 'the planner starts at 19:00 (evening)');
    const days = A.page.getByRole('radiogroup', { name: t.datePlan.day }).getByRole('radio');
    check((await days.nth(2).getAttribute('aria-checked')) === 'true', 'and on the shared day');
    await A.page.getByRole('radio', { name: new RegExp(venueName) }).click();
    await A.page.getByRole('button', { name: t.datePlan.send }).click();
    await A.page.waitForURL((url) => url.pathname.startsWith('/chat/'));

    // 3. Dan accepts; the date "happens" (moved three hours into the past).
    const page = await dan.call<{ messages: { date?: { id: string } }[] }>(
      'GET',
      `/v1/matches/${matchId}/messages`,
    );
    const planId = page.messages.findLast((m) => m.date)!.date!.id;
    await dan.call('POST', `/v1/dates/${planId}/accept`);
    await pool.query(`UPDATE date_plans SET starts_at = now() - interval '3 hours' WHERE id = $1`, [
      planId,
    ]);

    // 4. "Did you meet?" on her card: private answers, only a mutual "again" is shown.
    await A.page.reload();
    const feedback = A.page.getByTestId('date-feedback');
    await feedback.getByText(t.feedback.didYouMeet).waitFor();
    await feedback.getByRole('button', { name: t.feedback.metYes }).click();
    await feedback.getByRole('radio', { name: t.feedback.againOptions.yes, exact: true }).click();
    await feedback.getByText(t.feedback.change).waitFor();
    const danCard = await dan.call<{ messages: { date?: { feedback: unknown } }[] }>(
      'GET',
      `/v1/matches/${matchId}/messages`,
    );
    check(
      JSON.stringify(danCard.messages.findLast((m) => m.date)!.date!.feedback) ===
        JSON.stringify({ canGive: true, mine: null, bothAgain: false }),
      'Dan learns nothing of her answer',
    );
    await dan.call('POST', `/v1/dates/${planId}/feedback`, { met: true, again: 'yes' });
    await feedback.getByText(t.feedback.bothAgain).waitFor({ timeout: 15_000 });
    check(true, 'both said yes: "you both want to meet again" appears live');
    await feedback.scrollIntoViewIfNeeded();
    await shot(A.page, `${locale}/72-date-feedback`);

    // 5. The met-in-person badge, once she turns it on.
    await A.page.goto(`${WEB}/settings`);
    await A.page.getByRole('checkbox', { name: t.visibility.metBadgeLabel }).click();
    for (let i = 0; i < 20; i += 1) {
      if ((await maya.call<{ showMetBadge: boolean }>('GET', '/v1/me')).showMetBadge) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    await A.context.close();
  }
  const B = await open(browser, dan.session, locale);
  try {
    await B.page.goto(`${WEB}/profile/${maya.id}`);
    await B.page.getByTestId('met-badge').waitFor();
    check(true, 'Dan sees her met-in-person badge');
  } finally {
    await B.context.close();
  }

  // 6. Focus mode: six people waiting for her reply.
  for (let i = 0; i < 6; i += 1) {
    await pool.query('DELETE FROM rate_limit');
    const other = await member(locale, `${him}${i + 2}`, 'man', ['woman']);
    const id = await match(other, maya);
    await other.call('POST', `/v1/matches/${id}/messages`, {
      text: `Hi ${her}! ${i}`,
      clientId: `focus-${locale}-${i}-${Date.now()}`,
    });
  }
  const C = await open(browser, maya.session, locale);
  try {
    await C.page.goto(`${WEB}/discover`);
    const banner = C.page.getByTestId('your-turn');
    await banner.waitFor();
    check((await banner.innerText()).includes('6'), 'Discover says six people are waiting');
    await shot(C.page, `${locale}/73-your-turn`);
  } finally {
    await C.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
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
