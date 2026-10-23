// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 23 end to end, in every language:
 * - The matchmaker: a few taps, suggested changes, only the chosen ones applied.
 * - Video speed dating: an admin publishes the event; two people enter the lobby in two browsers
 *   (fake cameras), a round pairs them through a real LiveKit server, end-to-end encrypted; both
 *   say yes privately and get a match.
 * - Check-in at the venue: the dashboard shows a rotating QR code; its link fills in the code;
 *   the opt-in badge then shows on the profile.
 * Usage: pnpm --dir e2e live-events (needs LiveKit: see docs/phases/PHASE-15.md)
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser, type Page } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
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
  type OnboardedMember,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string, string]> = {
  en: ['Noa', 'Dan', 'Speed dating at Cafe Nord'],
  he: ['נועה', 'דן', 'ספיד־דייטינג בקפה נורד'],
  ar: ['نور', 'سامي', 'مواعدة سريعة في مقهى نورد'],
  ru: ['Ноа', 'Дима', 'Спид-дейтинг в кафе «Норд»'],
};
const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/{{(\w+)}}/g, (_, k: string) => String(v[k] ?? ''));

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
type Pool = ReturnType<typeof createDb>['pool'];

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string } | null,
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
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
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

/** An admin with MFA done, over HTTP: the same session works in the dashboard. */
async function adminSession(pool: Pool) {
  const email = `live-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

const videoPlaying = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0));

async function matchmaker(browser: Browser, locale: L, noa: OnboardedMember) {
  const t = T[locale];
  const A = await open(browser, locale, noa.session);
  try {
    await A.page.goto(`${WEB}/profile`);
    await A.page.getByRole('button', { name: new RegExp(t.matchmaker.open) }).click();
    await A.page.getByRole('radio', { name: t.intention.long_term }).click();
    await A.page.getByRole('button', { name: t.matchmaker.next }).click();
    await A.page.getByRole('radio', { name: t.matchmaker.a.distance.city }).click();
    await A.page.getByRole('button', { name: t.matchmaker.next }).click();
    await A.page.getByRole('radio', { name: t.matchmaker.a.ages.wide }).click();
    await A.page.getByRole('button', { name: t.matchmaker.next }).click();
    for (const interest of ['cooking', 'hiking', 'live_music'] as const) {
      await A.page.getByRole('checkbox', { name: t.interest[interest], exact: true }).click();
    }
    await shot(A.page, `${locale}/85-matchmaker`);
    await A.page.getByRole('button', { name: t.matchmaker.next }).click();
    await A.page.getByRole('radio', { name: t.matchmaker.a.smoking.no_smokers }).click();
    await A.page.getByRole('button', { name: t.matchmaker.next }).click();
    // Children: skipped.
    await A.page.getByRole('button', { name: t.matchmaker.skip }).click();
    await A.page.getByRole('button', { name: t.matchmaker.see }).click();
    const list = A.page.getByTestId('matchmaker-suggestions');
    await list.waitFor();
    // "What you're looking for" didn't change (long-term already): no suggestion for it.
    check(
      !(await list.getByText(t.matchmaker.field.intention, { exact: true }).isVisible()),
      'no suggestion where nothing would change',
    );
    // Keep the distance as it is: untick it.
    await A.page.getByRole('checkbox', { name: t.matchmaker.field.maxDistanceKm }).click();
    await shot(A.page, `${locale}/86-matchmaker-suggestions`);
    await A.page.getByRole('button', { name: fill(t.matchmaker.apply, { count: 3 }) }).click();
    await A.page.getByTestId('matchmaker-done').waitFor();
    const me = await noa.call<{
      preferences: { maxDistanceKm: number; ageMin: number };
      about: { interests: string[] };
      dealbreakers: { smokingOk: string[] };
    }>('GET', '/v1/me');
    check(
      me.preferences.maxDistanceKm === 50 &&
        me.about.interests.includes('live_music') &&
        me.dealbreakers.smokingOk.join() === 'no',
      'only the chosen changes were applied',
    );
  } finally {
    await A.context.close();
  }
}

async function run(locale: L, browser: Browser, pool: Pool) {
  const t = T[locale];
  const [her, him, title] = NAMES[locale];
  await pool.query('DELETE FROM rate_limit');
  // Each language starts with no other events, so the dashboard shows only this one.
  await pool.query('DELETE FROM events');
  await resetRouteLimits();
  const noa = await onboardMember(`live-${locale}`, her, 'woman', ['man']);
  const dan = await onboardMember(`live-${locale}`, him, 'man', ['woman']);

  // 1. The matchmaker.
  await matchmaker(browser, locale, noa);

  // 2. An admin publishes video speed dating, starting in a few seconds.
  const admin = await adminSession(pool);
  const { id: venueId } = await admin.call<{ id: string }>('POST', '/v1/admin/venues', {
    name: 'Cafe Nord',
    area: 'Tel Aviv',
    category: 'cafe',
    address: 'Dizengoff 99',
    stepFree: true,
  });
  const startsAt = new Date(Date.now() + 8_000);
  const { id: eventId } = await admin.call<{ id: string }>('POST', '/v1/admin/events', {
    title,
    description: '',
    venueId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
    capacity: 20,
    kind: 'speed',
    roundMinutes: 3,
  });
  await noa.call('POST', `/v1/events/${eventId}/rsvp`);
  await dan.call('POST', `/v1/events/${eventId}/rsvp`);
  await new Promise((r) => setTimeout(r, Math.max(0, startsAt.getTime() - Date.now() + 500)));

  const A = await open(browser, locale, noa.session);
  const B = await open(browser, locale, dan.session);
  try {
    await A.page.goto(`${WEB}/events/${eventId}`);
    await A.page.getByTestId('speed-label').waitFor();
    await shot(A.page, `${locale}/87-speed-event`);
    await A.page.getByRole('button', { name: t.events.speedEnter }).click();
    await A.page.getByTestId('speed-lobby').waitFor();
    check(true, 'the lobby opens for someone going');
    await B.page.goto(`${WEB}/speed/${eventId}`);
    // The next heartbeat or refresh pairs them.
    await A.page.getByTestId('speed-round').waitFor({ timeout: 30_000 });
    await B.page.getByTestId('speed-round').waitFor({ timeout: 30_000 });
    check(true, 'a round paired the two of them');
    await A.page.getByText(fill(t.call.connectedWith, { name: him })).waitFor({ timeout: 20_000 });
    await A.page.getByText(t.call.private).waitFor({ timeout: 15_000 });
    check(true, 'the round is end-to-end encrypted');
    check(!(await videoPlaying(A.page)), 'cameras start off');
    await B.page.getByRole('button', { name: t.call.cameraOn }).click();
    await B.page.getByRole('button', { name: t.call.cameraOff }).waitFor();
    await A.page
      .waitForFunction(
        () => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0),
        undefined,
        { timeout: 15_000 },
      )
      .catch(async (e) => {
        await A.page.screenshot({ path: '/tmp/claude-0/logs/speed-a.png' });
        await B.page.screenshot({ path: '/tmp/claude-0/logs/speed-b.png' });
        throw e;
      });
    await A.page.waitForFunction(
      () => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0),
      undefined,
      { timeout: 15_000 },
    );
    check(await videoPlaying(A.page), 'the camera turned on is seen');
    await shot(A.page, `${locale}/88-speed-round`);

    // Noa leaves the round early: it ends for both, and each answers privately.
    await A.page.getByRole('button', { name: t.speed.leaveRound }).click();
    const question = fill(t.speed.question, { name: him });
    await A.page.getByText(question).waitFor({ timeout: 15_000 });
    await A.page.getByRole('button', { name: t.speed.yes, exact: true }).click();
    await A.page.getByText(fill(t.speed.saidYes, { name: him })).waitFor();
    await B.page.getByText(fill(t.speed.question, { name: her })).waitFor({ timeout: 15_000 });
    await B.page.getByRole('button', { name: t.speed.yes, exact: true }).click();
    await B.page.getByText(fill(t.speed.matched, { name: her })).waitFor({ timeout: 15_000 });
    check(true, 'a mutual yes makes a match');
    await shot(B.page, `${locale}/89-speed-match`);
    const matches = await dan.call<{ matches: { profile: { id: string } }[] }>(
      'GET',
      '/v1/matches',
    );
    check(
      matches.matches.some((m) => m.profile.id === noa.id),
      'the match is in Matches',
    );

    // 3. Check-in at the venue: the QR code opens the event with the code filled in.
    const checkIn = await admin.call<{ url: string; code: string }>(
      'GET',
      `/v1/admin/events/${eventId}/check-in`,
    );
    await A.page.goto(checkIn.url);
    await A.page.getByTestId('check-in').waitFor();
    check(
      (await A.page.getByLabel(t.events.checkInCode).inputValue()) === checkIn.code,
      'the code from the QR link is filled in',
    );
    await shot(A.page, `${locale}/90-check-in`);
    await A.page.getByRole('button', { name: t.events.checkInButton }).click();
    await A.page.getByTestId('checked-in').waitFor();
    check(true, 'checked in at the venue');

    // The badge, opt-in.
    await A.page.goto(`${WEB}/settings`);
    await A.page.getByRole('checkbox', { name: t.visibility.eventBadgeLabel }).click();
    await A.page.waitForTimeout(500);
    await B.page.goto(`${WEB}/profile/${noa.id}`);
    await B.page.getByTestId('event-badge').waitFor();
    check(true, 'the badge shows on the profile');
    await shot(B.page, `${locale}/91-event-badge`);
  } finally {
    await A.context.close();
    await B.context.close();
  }

  // The dashboard's check-in screen (English and Hebrew).
  if (locale === 'en' || locale === 'he') {
    const a = adminMessages[locale];
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/events`);
      await S.page.getByRole('heading', { name: a.events.title }).waitFor();
      await S.page
        .getByRole('button', { name: `${a.events.checkIn} ${title}` })
        .first()
        .click();
      await S.page.getByRole('img', { name: a.events.checkInQrAlt }).waitFor();
      await S.page
        .getByText(fill(a.events.checkedInCount, { n: 1 }))
        .first()
        .waitFor();
      check(true, 'the dashboard shows the rotating code and who checked in (a count)');
      await shot(S.page, `${locale}/admin-13-check-in`);
    } finally {
      await S.context.close();
    }
  }
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 2 });
try {
  await pool.query(
    `INSERT INTO instance_settings (id, calls_enabled) VALUES (1, true)
     ON CONFLICT (id) DO UPDATE SET calls_enabled = true`,
  );
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser, pool);
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
