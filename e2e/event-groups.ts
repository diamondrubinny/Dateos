// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 71b end to end: an admin publishes an event with places by gender (2 women, 2 men) for
 * ages 25–40 in the dashboard and repeats it weekly; when the women's places are taken, a woman
 * joins the women's waiting list while men still have places; a member outside the audience sees
 * why and no "I'm going".
 * Usage: pnpm --dir e2e event-groups
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
  audit,
  LOCALE_TAGS,
  locales,
  magicLink,
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
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const DATA: Record<
  'en' | 'he',
  { title: string; venue: [string, string, string]; names: string[] }
> = {
  en: {
    title: 'Singles 25–40: wine and board games',
    venue: ['Cafe Nord', 'Tel Aviv', 'Dizengoff 99'],
    names: ['Noa', 'Maya', 'Tal', 'Sam'],
  },
  he: {
    title: 'רווקים ורווקות 25–40: יין ומשחקי קופסה',
    venue: ['קפה נורד', 'תל אביב', 'דיזנגוף 99'],
    names: ['נועה', 'מאיה', 'טל', 'סהר'],
  },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''));

async function open(browser: Browser, locale: L, member: OnboardedMember | null, width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
  });
  if (member) {
    const { name, value } = member.session;
    await context.addCookies([
      { name, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
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

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

/** The admin publishes the event with places by gender, then repeats it for 2 more weeks. */
async function adminPublishes(browser: Browser, locale: 'en' | 'he') {
  const a = adminMessages[locale];
  const d = DATA[locale];
  const email = `groups-admin-${locale}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  await pool.query('DELETE FROM rate_limit');
  const S = await open(browser, locale, null, 1280);
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
    await pool.query(
      `INSERT INTO venues (name, area, category, address) VALUES ($1, $2, 'cafe', $3)`,
      d.venue,
    );

    await S.page.getByRole('link', { name: a.events.nav }).click();
    await S.page.getByRole('heading', { name: a.events.title }).waitFor();
    await S.page.getByLabel(a.events.titleLabel).fill(d.title);
    await S.page
      .getByLabel(a.events.place, { exact: true })
      .selectOption({ label: `${d.venue[0]}, ${d.venue[1]}` });
    const date = new Date(Date.now() + 3 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await S.page
      .getByLabel(a.events.date)
      .fill(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
    await S.page.getByLabel(a.events.start).fill('19:00');
    await S.page.getByLabel(a.events.end).fill('22:00');
    await S.page.getByLabel(a.events.byGender).check();
    const genders = a.branding.genders;
    await S.page.getByLabel(fill(a.events.poolPlaces, { group: genders.woman })).fill('2');
    await S.page.getByLabel(fill(a.events.poolPlaces, { group: genders.man })).fill('2');
    await S.page.getByLabel(a.events.ageMin).fill('25');
    await S.page.getByLabel(a.events.ageMax).fill('40');
    await audit(S.page, `${locale}/admin-event-groups`);
    await S.page.getByRole('group', { name: a.events.audienceTitle }).scrollIntoViewIfNeeded();
    await shot(S.page, `${locale}/admin-10-event-groups`);
    await S.page.getByRole('button', { name: a.events.publish }).click();
    await S.page.getByText(fill(a.events.published, { title: d.title })).waitFor();
    const line = fill(a.events.poolLine, {
      group: genders.woman,
      n: 0,
      capacity: 2,
      waiting: 0,
    });
    const shown = await S.page
      .getByText(line)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check(shown, 'the list shows places by gender');

    // Repeat weekly: 2 more weeks.
    await S.page
      .getByRole('button', { name: new RegExp(`^${a.events.repeat}`) })
      .first()
      .click();
    await S.page.getByLabel(a.events.repeatWeeks).selectOption('2');
    await S.page.getByRole('button', { name: a.events.repeatYes }).click();
    await S.page.getByText(fill(a.events.repeated, { title: d.title, n: 2 })).waitFor();
    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM events WHERE title = $1`, [
      d.title,
    ]);
    check(rows[0].c === 3, 'repeated weekly: 3 events');
    await audit(S.page, `${locale}/admin-event-repeat`);
  } finally {
    await S.context.close();
  }
  const { rows } = await pool.query(
    `SELECT id FROM events WHERE title = $1 ORDER BY starts_at LIMIT 1`,
    [d.title],
  );
  return rows[0].id as string;
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
    await pool.query('DELETE FROM events');
    await pool.query('DELETE FROM venues');
    await resetRouteLimits();
    const eventId = await adminPublishes(browser, locale as 'en' | 'he');
    const [her, other, tal, sahar] = d.names as [string, string, string, string];
    const noa = await onboardMember(`groups-${locale}`, her, 'woman', ['man']);
    const maya = await onboardMember(`groups-${locale}`, other, 'woman', ['man']);
    const talM = await onboardMember(`groups-${locale}`, tal, 'woman', ['man']);
    const sam = await onboardMember(`groups-${locale}`, sahar, 'man', ['woman']);
    await pool.query(`UPDATE profiles SET gender = 'nonbinary' WHERE user_id = $1`, [sam.id]);
    await noa.call('POST', `/v1/events/${eventId}/rsvp`);
    await maya.call('POST', `/v1/events/${eventId}/rsvp`);

    // 1. Tal: women's places are taken; the women's waiting list; men still have places.
    const A = await open(browser, locale, talM);
    try {
      await A.page.goto(`${WEB}/events/${eventId}`);
      await A.page.getByTestId('event-audience').waitFor();
      const group = (g: 'woman' | 'man') => t.eventGroups.groups[g];
      check(
        await A.page
          .getByText(fill(t.eventGroups.groupFull, { group: group('woman') }))
          .isVisible(),
        'women: full',
      );
      check(
        await A.page
          .getByText(fill(t.eventGroups.placesLeft, { group: group('man'), count: 2 }))
          .isVisible(),
        'men: 2 places left',
      );
      await A.page.getByRole('button', { name: t.events.waitlistJoin }).click();
      await A.page.getByRole('button', { name: t.events.waitlistLeave }).waitFor();
      check(true, 'Tal is on the women’s waiting list');
      await audit(A.page, `${locale}/event-groups`);
      await shot(A.page, `${locale}/180-event-groups`);
    } finally {
      await A.context.close();
    }

    // 2. Sam (nonbinary): the event has no places for them; told why, no "I'm going".
    const B = await open(browser, locale, sam);
    try {
      await B.page.goto(`${WEB}/events/${eventId}`);
      await B.page.getByTestId('not-for-you').waitFor();
      check(
        (await B.page.getByRole('button', { name: t.events.going }).count()) === 0,
        'outside the audience: no “I’m going”, and why',
      );
      await audit(B.page, `${locale}/event-not-for-you`);
      await shot(B.page, `${locale}/181-not-for-you`);
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
process.stdout.write('\nEvent groups: OK\n');
