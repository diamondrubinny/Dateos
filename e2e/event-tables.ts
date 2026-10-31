// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 71d end to end: before the reveal an event shows its area only, and a member going joins a
 * table with three quick questions; after the reveal it shows the place, and the member sees their
 * table and the first names at it. Times are moved in the database.
 * Usage: pnpm --dir e2e event-tables
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
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetRouteLimits,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const DATA: Record<'en' | 'he', { title: string; place: string; women: string[]; men: string[] }> =
  {
    en: {
      title: 'Dinner with strangers',
      place: 'The Secret Garden',
      women: ['Noa', 'Maya', 'Tal'],
      men: ['Dan', 'Gil', 'Eli'],
    },
    he: {
      title: 'ארוחת ערב עם זרים',
      place: 'הגינה הסודית',
      women: ['נועה', 'מאיה', 'טל'],
      men: ['דן', 'גיל', 'אלי'],
    },
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
    timezoneId: 'Asia/Jerusalem',
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

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminCall() {
  const email = `tables-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return call;
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const d = DATA[locale as 'en' | 'he'];
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM events');
    await resetRouteLimits();
    const admin = await adminCall();
    const { id: venueId } = await admin<{ id: string }>('POST', '/v1/admin/venues', {
      name: d.place,
      area: 'Tel Aviv',
      category: 'restaurant',
      address: 'Hidden st. 7',
    });
    const start = Date.now() + 48 * 3_600_000;
    const { id } = await admin<{ id: string }>('POST', '/v1/admin/events', {
      title: d.title,
      venueId,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3 * 3_600_000).toISOString(),
      revealHours: 24,
      tableSize: 4,
    });
    const people: OnboardedMember[] = [];
    for (const name of d.women)
      people.push(await onboardMember(`tables-${locale}`, name, 'woman', ['man']));
    for (const name of d.men)
      people.push(await onboardMember(`tables-${locale}`, name, 'man', ['woman']));
    for (const m of people) await m.call('POST', `/v1/events/${id}/rsvp`);
    const noa = people[0]!;

    // 1. Before the reveal: the area only, and joining a table.
    const A = await open(browser, locale, noa);
    try {
      await A.page.goto(`${WEB}/events/${id}`);
      await A.page.getByTestId('place-hidden').waitFor();
      check(!(await A.page.getByText(d.place).isVisible()), 'the place is hidden for now');
      const table = A.page.getByTestId('event-table');
      await table.waitFor();
      await table.getByRole('radio', { name: t.eventTable.paces.calm }).click();
      await table.getByRole('radio', { name: t.eventTable.talks.deep }).click();
      await table.getByRole('radio', { name: t.eventTable.drinkOptions.either }).click();
      await audit(A.page, `${locale}/event-table-join`);
      await table.scrollIntoViewIfNeeded();
      await shot(A.page, `${locale}/183-event-table-join`);
      await table.getByRole('button', { name: t.eventTable.join }).click();
      await table.getByRole('button', { name: t.eventTable.leave }).waitFor();
      check(true, 'joined a table with three answers');
    } finally {
      await A.context.close();
    }

    // The others join; then the reveal passes.
    for (const [i, m] of people.slice(1).entries()) {
      await m.call('PUT', `/v1/events/${id}/table`, {
        pace: i % 2 ? 'calm' : 'lively',
        talk: 'deep',
        drinks: 'either',
      });
    }
    await pool.query(
      `UPDATE events SET starts_at = now() + interval '2 hours', ends_at = now() + interval '5 hours'
       WHERE id = $1`,
      [id],
    );

    // 2. After the reveal: the place, and my table with first names.
    const B = await open(browser, locale, noa);
    try {
      await B.page.goto(`${WEB}/events/${id}`);
      await B.page.getByTestId('my-table').waitFor();
      check(await B.page.getByText(d.place).first().isVisible(), 'the place is revealed');
      const mine = await noa.call<{ mates: string[]; tableNo: number }>(
        'GET',
        `/v1/events/${id}/table`,
      );
      const text = await B.page.getByTestId('event-table').innerText();
      check(
        mine.mates.length === 2 && mine.mates.every((n) => text.includes(n)),
        'my table shows the first names at it (and only those)',
      );
      await audit(B.page, `${locale}/event-table`);
      await B.page.getByTestId('event-table').scrollIntoViewIfNeeded();
      await shot(B.page, `${locale}/184-event-table`);
    } finally {
      await B.context.close();
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
process.stdout.write('\nTables and the place revealed later: OK\n');
