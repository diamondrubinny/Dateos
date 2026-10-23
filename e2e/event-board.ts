// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Event updates and questions to the organizers (phase 27) end to end, in every language:
 * an admin posts an update (in the dashboard in English and Hebrew), a member going sees it and
 * asks a question in the app, the admin answers without seeing who asked, and the member reads the
 * answer. Nobody sees who else is going.
 * Usage: pnpm --dir e2e event-board
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
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
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const TEXT: Record<L, { title: string; update: string; question: string; answer: string }> = {
  en: {
    title: 'Board games night',
    update: 'We moved inside to the café: it might rain.',
    question: 'Is there parking nearby?',
    answer: 'Yes, free parking at gate 3.',
  },
  he: {
    title: 'ערב משחקי קופסה',
    update: 'עברנו פנימה לבית הקפה: אולי ירד גשם.',
    question: 'יש חניה קרובה?',
    answer: 'כן, חניה חינם בשער 3.',
  },
  ar: {
    title: 'أمسية ألعاب الطاولة',
    update: 'انتقلنا إلى داخل المقهى: قد تمطر.',
    question: 'هل يوجد موقف سيارات قريب؟',
    answer: 'نعم، موقف مجاني عند البوابة 3.',
  },
  ru: {
    title: 'Вечер настольных игр',
    update: 'Мы перешли внутрь кафе: может пойти дождь.',
    question: 'Есть ли рядом парковка?',
    answer: 'Да, бесплатная парковка у ворот 3.',
  },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
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
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

type Pool = ReturnType<typeof createDb>['pool'];
async function adminSession(pool: Pool) {
  const email = `event-board-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  const venue = await call<{ id: string }>('POST', '/v1/admin/venues', {
    name: 'Garden Café',
    area: 'Tel Aviv',
    category: 'cafe',
    address: '1 Example St',
    note: null,
    stepFree: true,
  });
  return { session, call, venueId: venue.id };
}
type Admin = Awaited<ReturnType<typeof adminSession>>;

async function run(browser: Browser, locale: L, admin: Admin) {
  const t = T[locale];
  const text = TEXT[locale];
  const dashboard = locale === 'en' || locale === 'he';
  const a = adminMessages[dashboard ? locale : 'en'].events;
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setMinutes(0, 0, 0);
  const event = await admin.call<{ id: string }>('POST', '/v1/admin/events', {
    title: `${text.title} ${Date.now() % 10_000}`,
    description: '🎲',
    venueId: admin.venueId,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
  });
  const member = await onboardMember(`event-board-${locale}`, 'Noa', 'woman', ['man']);
  await member.call('POST', `/v1/events/${event.id}/rsvp`);
  const title = (
    await admin.call<{ events: { id: string; title: string }[] }>('GET', '/v1/admin/events')
  ).events.find((e) => e.id === event.id)!.title;

  // 1. The update: in the dashboard where it speaks the language, else through the API.
  if (dashboard) {
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/events`);
      await S.page.getByRole('button', { name: `${a.board} ${title}` }).click();
      await S.page.getByLabel(a.updateLabel).fill(text.update);
      await S.page.getByRole('button', { name: a.postUpdate }).click();
      await S.page.getByText(a.updatePosted).waitFor();
      check(true, 'the admin posted an update in the dashboard');
    } finally {
      await S.context.close();
    }
  } else {
    await admin.call('POST', `/v1/admin/events/${event.id}/updates`, { body: text.update });
  }

  // 2. The member sees it and asks a question.
  const M = await open(browser, locale, member.session);
  try {
    await M.page.goto(`${WEB}/events/${event.id}`);
    await M.page.getByText(text.update).waitFor();
    check(true, 'the member going sees the update');
    await M.page.getByLabel(t.eventBoard.question).fill(text.question);
    await M.page.getByRole('button', { name: t.eventBoard.send }).click();
    await M.page.getByText(t.eventBoard.sent).waitFor();
    await M.page.getByText(t.eventBoard.waiting).waitFor();
  } finally {
    await M.context.close();
  }

  // 3. The admin answers without seeing who asked.
  if (dashboard) {
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/events`);
      await S.page.getByRole('button', { name: `${a.board} ${title}` }).click();
      await S.page.getByText(text.question).waitFor();
      const panel = (await S.page.locator('section.board').innerText()) ?? '';
      check(
        !panel.includes('Noa') && !panel.includes(member.email),
        'the dashboard never shows who asked',
      );
      await S.page.getByLabel(a.answerLabel).fill(text.answer);
      await S.page.getByRole('button', { name: a.sendAnswer }).click();
      await S.page.getByText(a.answerSent).waitFor();
      await S.page.locator('section.board').scrollIntoViewIfNeeded();
      await shot(S.page, `${locale}/admin-17-event-board`);
    } finally {
      await S.context.close();
    }
  } else {
    const board = await admin.call<{ questions: { id: string }[] }>(
      'GET',
      `/v1/admin/events/${event.id}/board`,
    );
    await admin.call(
      'POST',
      `/v1/admin/events/${event.id}/questions/${board.questions[0]!.id}/answer`,
      { answer: text.answer },
    );
  }

  // 4. Only the asker reads the answer.
  const M2 = await open(browser, locale, member.session);
  try {
    await M2.page.goto(`${WEB}/events/${event.id}`);
    await M2.page.getByText(text.answer, { exact: false }).waitFor();
    check(true, 'the member reads the answer');
    await M2.page.getByTestId('event-board').scrollIntoViewIfNeeded();
    await shot(M2.page, `${locale}/101-event-board`);
  } finally {
    await M2.context.close();
  }
  // Someone not going learns nothing.
  const other = await onboardMember(`event-board-${locale}`, 'Dan', 'man', ['woman']);
  const res = await fetch(
    `${process.env.API_URL ?? 'http://localhost:4000'}/v1/events/${event.id}/board`,
    {
      headers: { cookie: other.session.header },
    },
  );
  check(res.status === 404, 'someone not going gets nothing');
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 2 });
try {
  await pool.query('DELETE FROM rate_limit');
  await resetRouteLimits();
  const admin = await adminSession(pool);
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await pool.query('DELETE FROM rate_limit');
    await run(browser, locale, admin);
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
