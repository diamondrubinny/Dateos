// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 42 end to end: "Add to calendar" on an accepted date and on an event you're going to.
 * The .ics file is made in the browser; we read it and check what it does (and doesn't) say.
 * Usage: pnpm --dir e2e calendar
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser, type Page } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
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

const T = { en, he } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = { en: ['Maya', 'Dan'], he: ['מאיה', 'דן'] };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function open(browser: Browser, locale: L, member: OnboardedMember) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    acceptDownloads: true,
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

/** Clicks "Add to calendar" and returns the downloaded file's text. */
async function download(page: Page, label: string): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: label }).first().click(),
  ]);
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [her, him] = NAMES[locale];
    const maya = await onboardMember(`cal-${locale}`, her, 'woman', ['man']);
    const dan = await onboardMember(`cal-${locale}`, him, 'man', ['woman']);
    const venueName = `Café Puaa ${locale} ${Date.now() % 100000}`;
    const { rows: venue } = await pool.query<{ id: string }>(
      `INSERT INTO venues (name, area, category, address, step_free)
       VALUES ($1, 'Jaffa', 'cafe', 'Rabbi Yohanan St 8', true) RETURNING id`,
      [venueName],
    );

    // An accepted date in three days, 17:00 UTC.
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    const { matchId } = await maya.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    startsAt.setUTCHours(17, 0, 0, 0);
    const proposed = await maya.call<{ date: { id: string } }>(
      'POST',
      `/v1/matches/${matchId}/dates`,
      { venueId: venue[0]!.id, startsAt: startsAt.toISOString(), clientId: `cal-${Date.now()}` },
    );
    await dan.call('POST', `/v1/dates/${proposed.date.id}/accept`);

    // An event she's going to.
    const { rows: event } = await pool.query<{ id: string }>(
      `INSERT INTO events (title, description, venue_id, starts_at, ends_at)
       VALUES ($1, '', $2, now() + interval '5 days', now() + interval '5 days 2 hours')
       RETURNING id`,
      [locale === 'he' ? 'ערב משחקי קופסה' : 'Board games night', venue[0]!.id],
    );
    await maya.call('POST', `/v1/events/${event[0]!.id}/rsvp`);

    const A = await open(browser, locale, maya);
    try {
      // 1. The date.
      await A.page.goto(`${WEB}/chat/${matchId}`);
      await A.page.getByRole('button', { name: t.calendar.add }).first().waitFor();
      await audit(A.page, `${locale}/calendar-date`);
      await shot(A.page, `${locale}/115-calendar-date`);
      const dateFile = await download(A.page, t.calendar.add);
      const stamp = startsAt
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
      check(dateFile.name.endsWith('.ics'), `a calendar file (${dateFile.name})`);
      check(dateFile.text.includes(`DTSTART:${stamp}`), 'at the date’s time (UTC)');
      check(dateFile.text.includes(venueName), 'at the place');
      check(
        !dateFile.text.includes(him) && !/SUMMARY:.*NexaHeart/.test(dateFile.text),
        'without the person’s name or the app’s name',
      );

      // 2. The event.
      await A.page.goto(`${WEB}/events/${event[0]!.id}`);
      await A.page.getByRole('button', { name: t.calendar.add }).waitFor();
      const eventFile = await download(A.page, t.calendar.add);
      check(
        eventFile.text.includes(locale === 'he' ? 'ערב משחקי קופסה' : 'Board games night'),
        'the event’s title is in its calendar file',
      );
      check(/DTEND:\d{8}T\d{6}Z/.test(eventFile.text), 'with its end time');
      await audit(A.page, `${locale}/calendar-event`);
    } finally {
      await A.context.close();
    }
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
process.stdout.write('\nAdd to calendar: OK\n');
