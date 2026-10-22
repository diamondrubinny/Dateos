// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Community events end to end: an admin publishes an event in the dashboard (English and Hebrew,
 * which the dashboard supports), and a member finds it in the app and says they're going, in every
 * language. Only the number of people going is ever shown.
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { demoPhoto } from './demo-images.ts';
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
  magicLink,
  reportA11y,
  shot,
  showcase,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const DATA: Record<
  L,
  {
    venue: [string, string, string];
    title: string;
    description: string;
    other: string;
    full: string;
  }
> = {
  en: {
    venue: ['HaYarkon Park', 'Tel Aviv', 'Rokach Blvd'],
    title: 'Picnic and board games',
    description: 'Bring a blanket and your favourite game. We bring snacks and name tags.',
    other: 'Walking tour of old Jaffa',
    full: 'Sunset salsa class',
  },
  he: {
    venue: ['פארק הירקון', 'תל אביב', 'שדרות רוקח'],
    title: 'פיקניק ומשחקי קופסה',
    description: 'הביאו שמיכה ואת המשחק האהוב עליכם. אנחנו מביאים כיבוד ותגי שם.',
    other: 'סיור רגלי ביפו העתיקה',
    full: 'שיעור סלסה בשקיעה',
  },
  ar: {
    venue: ['حديقة اليركون', 'تل أبيب', 'جادة روكاح'],
    title: 'نزهة وألعاب لوحية',
    description: 'أحضر بطانية ولعبتك المفضلة. نحن نحضر الوجبات الخفيفة وبطاقات الأسماء.',
    other: 'جولة مشي في يافا القديمة',
    full: 'درس سالسا عند الغروب',
  },
  ru: {
    venue: ['Парк Яркон', 'Тель-Авив', 'бульвар Роках'],
    title: 'Пикник и настольные игры',
    description: 'Возьмите плед и любимую игру. Угощение и бейджи с именами — с нас.',
    other: 'Пешая прогулка по старому Яффо',
    full: 'Урок сальсы на закате',
  },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
type Pool = ReturnType<typeof createDb>['pool'];

async function open(
  browser: Browser,
  session: { name: string; value: string } | null,
  locale: L,
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

/** Next Saturday (at least two days away), as YYYY-MM-DD in local time. */
function nextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The dashboard is in English and Hebrew: an admin publishes the event with the form. */
async function adminPublishes(browser: Browser, locale: 'en' | 'he', pool: Pool) {
  const a = adminMessages[locale];
  const d = DATA[locale];
  const email = `events-admin-${locale}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  await pool.query('DELETE FROM rate_limit');
  const S = await open(browser, null, locale, 1280);
  try {
    await S.page.goto(`${ADMIN}/`);
    await S.page.getByLabel(a.signIn.email).fill(email);
    await S.page.getByRole('button', { name: a.signIn.submit }).click();
    await S.page.getByText(a.signIn.sent).waitFor();
    await S.page.goto(await magicLink(email));
    await S.page.getByRole('button', { name: a.mfa.start }).click();
    const secret = (await S.page.locator('code.secret').innerText()).replace(/\s/g, '');
    await S.page.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
    await S.page.getByRole('button', { name: a.mfa.submit }).click();
    await S.page.getByRole('heading', { name: a.reports.title }).waitFor();

    await S.page.getByRole('link', { name: a.events.nav }).click();
    await S.page.getByRole('heading', { name: a.events.title }).waitFor();
    await S.page.getByLabel(a.events.titleLabel).fill(d.title);
    await S.page.getByLabel(a.events.description).fill(d.description);
    await S.page.getByLabel(a.events.place).selectOption({ label: `${d.venue[0]}, ${d.venue[1]}` });
    await S.page.getByLabel(a.events.date).fill(nextSaturday());
    await S.page.getByLabel(a.events.start).fill('17:00');
    await S.page.getByLabel(a.events.end).fill('20:00');
    await S.page.getByLabel(a.events.capacity).fill('40');
    await S.page.getByRole('button', { name: a.events.publish }).click();
    await S.page.getByText(a.events.published.replace('{{title}}', d.title)).waitFor();
    const row = S.page.getByRole('rowheader', { name: new RegExp(d.title) });
    await row.waitFor({ timeout: 10_000 }).catch(() => undefined);
    check(await row.isVisible(), 'the admin published an event in the dashboard');
    await shot(S.page, `${locale}/admin-09-events`);
  } finally {
    await S.context.close();
  }
}

async function run(locale: L, browser: Browser, pool: Pool) {
  const t = T[locale];
  const d = DATA[locale];
  // Each language starts from its own place and events.
  await pool.query('DELETE FROM events');
  await pool.query('DELETE FROM venues');
  const { rows } = await pool.query(
    `INSERT INTO venues (name, area, category, address, step_free) VALUES ($1, $2, 'park', $3, true) RETURNING id`,
    d.venue,
  );
  const venueId = rows[0].id as string;
  // A second event, already with people going, so the list shows real counts.
  // Times are written in the browsers' time zone (Asia/Jerusalem), like an admin in Israel would.
  await pool.query(
    `INSERT INTO events (title, venue_id, starts_at, ends_at, capacity)
     VALUES ($1, $2, (current_date + 9 + time '10:00') AT TIME ZONE 'Asia/Jerusalem',
             (current_date + 9 + time '12:00') AT TIME ZONE 'Asia/Jerusalem', 25)`,
    [d.other, venueId],
  );
  if (locale === 'en' || locale === 'he') {
    await adminPublishes(browser, locale, pool);
  } else {
    await pool.query(
      `INSERT INTO events (title, description, venue_id, starts_at, ends_at, capacity)
       VALUES ($1, $2, $3, ($4::date + time '17:00') AT TIME ZONE 'Asia/Jerusalem',
               ($4::date + time '20:00') AT TIME ZONE 'Asia/Jerusalem', 40)`,
      [d.title, d.description, venueId, nextSaturday()],
    );
  }
  // A full event (2 places, both taken) for the waiting list.
  await pool.query(
    `INSERT INTO events (title, venue_id, starts_at, ends_at, capacity)
     VALUES ($1, $2, (current_date + 12 + time '18:00') AT TIME ZONE 'Asia/Jerusalem',
             (current_date + 12 + time '20:00') AT TIME ZONE 'Asia/Jerusalem', 2)`,
    [d.full, venueId],
  );
  // A few people already going (anonymous to everyone, including in this test's screenshots).
  const others = await pool.query(
    `SELECT id FROM "user" WHERE email LIKE '%@demo.nexaheart.invalid' ORDER BY email LIMIT 7`,
  );
  for (const [i, o] of others.rows.entries()) {
    await pool.query(
      `INSERT INTO event_rsvps (event_id, user_id)
       SELECT id, $1 FROM events WHERE title <> $4 AND ($2 OR title = $3)`,
      [o.id, i < 3, d.other, d.full],
    );
    if (i < 2) {
      await pool.query(
        `INSERT INTO event_rsvps (event_id, user_id) SELECT id, $1 FROM events WHERE title = $2`,
        [o.id, d.full],
      );
    }
  }

  await pool.query('DELETE FROM rate_limit');
  const member = await signInHttp(`events-member-${locale}-${Date.now()}@example.test`);
  await completeProfile(member.header);
  const A = await open(browser, member, locale);
  try {
    await A.page.goto(`${WEB}/matches`);
    await A.page
      .getByRole('link', { name: new RegExp(t.events.entry.split('{{')[0]!.trim()) })
      .click();
    await A.page.getByRole('heading', { name: t.events.title }).first().waitFor();
    await A.page.getByText(d.title).waitFor();
    await shot(A.page, `${locale}/48-events-list`);
    await A.page.getByText(d.title).click();
    await A.page.getByRole('button', { name: t.events.going }).waitFor();
    await shot(A.page, `${locale}/49-event-detail`);
    await A.page.getByRole('button', { name: t.events.going }).click();
    await A.page.getByRole('button', { name: t.events.notGoing }).waitFor();
    const going = await A.page
      .getByText(t.events.youreGoing.replace('{{count}}', '4'))
      .last()
      .isVisible();
    check(going, 'the member is going, and the count went up by one');
    const page = await A.page.content();
    check(!/@demo\.nexaheart\.invalid|Noam|Omer|Amit/.test(page), 'no names of people going');
    await shot(A.page, `${locale}/50-event-going`);

    // A full event: join the waiting list, see your place in line (a number, never names).
    await A.page.goto(`${WEB}/events`);
    await A.page.getByText(d.full).click();
    await A.page.getByRole('button', { name: t.events.waitlistJoin }).click();
    await A.page.getByRole('button', { name: t.events.waitlistLeave }).waitFor();
    check(
      await A.page.getByText(t.events.waiting.replace('{{count}}', '0')).last().isVisible(),
      'on the waiting list, first in line',
    );
    await shot(A.page, `${locale}/58-event-waitlist`);
  } finally {
    await A.context.close();
  }
}

/** A member with a finished profile, so the app doesn't send them back to onboarding. */
async function completeProfile(cookie: string) {
  const call = apiClient(cookie);
  await call('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: '2026-10' },
      { kind: 'privacy', granted: true, version: '2026-10' },
      { kind: 'sensitive', granted: true, version: '1' },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  await call('POST', '/v1/me/profile', {
    displayName: 'Tamar',
    birthDate: '1993-03-03',
    gender: 'woman',
    interestedIn: ['man'],
    intention: 'long_term',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: 'A picnic, then a board game.' }],
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
    if (me.photos[0]?.status === 'clean') return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('photo was not processed');
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const { pool } = createDb(process.env.DATABASE_URL ?? '');
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser, pool);
    await showcase(
      `showcase-events-${locale}`,
      ['48-events-list', '49-event-detail', '50-event-going'].map((n) => `${locale}/${n}`),
    );
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length) {
  process.stdout.write(`\n${problems.length} check(s) failed\n${problems.join('\n')}\n`);
  process.exitCode = 1;
}
