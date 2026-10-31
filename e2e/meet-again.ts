// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 71a end to end: after an in-person event, two members who checked in open "Meet again",
 * choose each other and get a match; a member who missed two events sees new places paused and
 * excuses one. Times and check-ins are set in the database (the check-in itself is phase 23's).
 * Usage: pnpm --dir e2e meet-again
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
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
const NAMES: Record<L, { her: string; him: string; other: string; events: string[] }> = {
  en: { her: 'Noa', him: 'Dan', other: 'Gil', events: ['Board games night', 'Picnic', 'Quiz'] },
  he: { her: 'נועה', him: 'דן', other: 'גיל', events: ['ערב משחקי קופסה', 'פיקניק', 'חידון'] },
  ar: { her: 'ليلى', him: 'سامي', other: 'كريم', events: ['أمسية ألعاب', 'نزهة', 'مسابقة'] },
  ru: { her: 'Маша', him: 'Дима', other: 'Гоша', events: ['Вечер настолок', 'Пикник', 'Квиз'] },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''));

async function open(browser: Browser, locale: L, member: OnboardedMember) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
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

/** An admin with MFA done, over HTTP. */
async function adminSession() {
  const email = `meet-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return call;
}

/** An event that ended `hoursAgo` hours ago, with these people going and these checked in. */
async function pastEvent(
  admin: Awaited<ReturnType<typeof adminSession>>,
  venueId: string,
  title: string,
  hoursAgo: number,
  going: OnboardedMember[],
  checkedIn: OnboardedMember[],
) {
  const start = Date.now() + 3_600_000;
  const { id } = await admin<{ id: string }>('POST', '/v1/admin/events', {
    title,
    description: '',
    venueId,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * 3_600_000).toISOString(),
  });
  for (const m of going) await m.call('POST', `/v1/events/${id}/rsvp`);
  await pool.query(
    `UPDATE events SET starts_at = now() - make_interval(hours => $2 + 2),
                       ends_at = now() - make_interval(hours => $2)
     WHERE id = $1`,
    [id, hoursAgo],
  );
  await pool.query(
    `UPDATE event_rsvps SET checked_in_at = now() - make_interval(hours => $3 + 1)
     WHERE event_id = $1 AND user_id = ANY($2::text[])`,
    [id, checkedIn.map((m) => m.id), hoursAgo],
  );
  return id;
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const names = NAMES[locale];
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM events');
    await resetRouteLimits();
    const noa = await onboardMember(`meet-${locale}`, names.her, 'woman', ['man']);
    const dan = await onboardMember(`meet-${locale}`, names.him, 'man', ['woman']);
    const gil = await onboardMember(`meet-${locale}`, names.other, 'man', ['woman']);
    const admin = await adminSession();
    const { id: venueId } = await admin<{ id: string }>('POST', '/v1/admin/venues', {
      name: 'Cafe Nord',
      area: 'Tel Aviv',
      category: 'cafe',
      address: 'Dizengoff 99',
      stepFree: true,
    });
    const [games, picnic, quiz] = names.events as [string, string, string];
    const meetup = await pastEvent(admin, venueId, games, 1, [noa, dan], [noa, dan]);
    await pastEvent(admin, venueId, picnic, 30, [noa, gil], [noa]);
    await pastEvent(admin, venueId, quiz, 6, [noa, gil], [noa]);

    // 1. Meet again: Noa finds it from the events list and joins; nobody else yet.
    const A = await open(browser, locale, noa);
    try {
      await A.page.goto(`${WEB}/events`);
      await A.page.getByText(t.meetAgain.listStatus).first().waitFor();
      check(true, 'the ended event says Meet again is open');
      await A.page.getByRole('link', { name: new RegExp(games) }).click();
      await A.page.getByTestId('meet-again').waitFor();
      await A.page.getByRole('button', { name: t.meetAgain.open }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/events/meet-again/'));
      await A.page.getByRole('button', { name: t.meetAgain.join }).click();
      await A.page.getByTestId('meet-again-empty').waitFor();
      check(true, 'joined; nobody else has yet');

      // 2. Dan joins; Noa chooses him: only she knows.
      await dan.call('POST', `/v1/events/${meetup}/meet-again`);
      await A.page.reload();
      const person = A.page.getByTestId('meet-again-person');
      await person.waitFor();
      await person
        .getByRole('button', { name: fill(t.meetAgain.choose, { name: names.him }) })
        .click();
      await person.getByText(t.meetAgain.chosen).waitFor();
      const his = await dan.call<{ people: { picked: boolean; matchId: string | null }[] }>(
        'GET',
        `/v1/events/${meetup}/meet-again`,
      );
      check(
        his.people[0]?.picked === false && his.people[0]?.matchId === null,
        'Dan learns nothing from a one-sided choice',
      );
      await audit(A.page, `${locale}/meet-again`);
      await shot(A.page, `${locale}/177-meet-again`);

      // 3. Dan chooses her too: a match for both.
      await dan.call('PUT', `/v1/events/${meetup}/meet-again/${noa.id}`, { yes: true });
      await A.page.reload();
      await A.page.getByText(fill(t.meetAgain.mutual, { name: names.him })).waitFor();
      check(true, 'both chose: “you both want to meet again”');
      await audit(A.page, `${locale}/meet-again-match`);
      await shot(A.page, `${locale}/178-meet-again-match`);
      await A.page.getByRole('button', { name: t.meetAgain.openChat }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/chat/'));
      check(true, 'the chat opens');
    } finally {
      await A.context.close();
    }

    // 4. Gil missed two events: new places paused; he excuses one.
    const G = await open(browser, locale, gil);
    try {
      await G.page.goto(`${WEB}/events`);
      const card = G.page.getByTestId('event-misses');
      await card.waitFor();
      check(
        (await card.innerText()).includes(t.eventMisses.pausedTitle),
        'new places are paused, said privately',
      );
      await audit(G.page, `${locale}/event-misses`);
      await shot(G.page, `${locale}/179-event-misses`);
      await card
        .getByRole('button', { name: fill(t.eventMisses.excuse, { event: picnic }) })
        .click();
      await card.getByRole('heading', { name: t.eventMisses.title }).waitFor();
      const after = await card.innerText();
      check(
        after.includes(fill(t.eventMisses.first, { event: quiz })) &&
          !after.includes(t.eventMisses.excuseHint),
        'after one excuse: just a note, and no second excuse this month',
      );
      const state = await gil.call<{ pausedUntil: string | null }>('GET', '/v1/me/event-misses');
      check(state.pausedUntil === null, 'the pause is lifted');
    } finally {
      await G.context.close();
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
process.stdout.write('\nMeet again and missed events: OK\n');
