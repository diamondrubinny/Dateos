// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 71c end to end: during an event, a member going sends "I need help now"; the dashboard
 * shows it first and highlighted, without who wrote; the admin answers and the member sees it. The
 * event page shows the Hebrew date (in Hebrew) and Share.
 * Usage: pnpm --dir e2e event-help
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
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const TEXT: Record<'en' | 'he', { title: string; help: string; answer: string; name: string }> = {
  en: {
    title: 'Board games night',
    help: 'Someone keeps following me. I’m by the bar, blue shirt.',
    answer: 'A host is on the way to the bar now.',
    name: 'Noa',
  },
  he: {
    title: 'ערב משחקי קופסה',
    help: 'מישהו לא מפסיק ללכת אחריי. אני ליד הבר, בחולצה כחולה.',
    answer: 'מארחת בדרך אלייך לבר עכשיו.',
    name: 'נועה',
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
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession() {
  const email = `event-help-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale as 'en' | 'he'].events;
    const text = TEXT[locale as 'en' | 'he'];
    await pool.query('DELETE FROM rate_limit');
    await pool.query('DELETE FROM events');
    await resetRouteLimits();
    const admin = await adminSession();
    const { id: venueId } = await admin.call<{ id: string }>('POST', '/v1/admin/venues', {
      name: 'Cafe Nord',
      area: 'Tel Aviv',
      category: 'cafe',
      address: 'Dizengoff 99',
    });
    const start = Date.now() + 3_600_000;
    const { id } = await admin.call<{ id: string }>('POST', '/v1/admin/events', {
      title: text.title,
      venueId,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3 * 3_600_000).toISOString(),
    });
    const noa = await onboardMember(`help-${locale}`, text.name, 'woman', ['man']);
    await noa.call('POST', `/v1/events/${id}/rsvp`);
    // The event is on now (started 10 minutes ago).
    await pool.query(
      `UPDATE events SET starts_at = now() - interval '10 minutes',
                         ends_at = now() + interval '2 hours' WHERE id = $1`,
      [id],
    );

    // 1. The member asks for help during the event.
    const M = await open(browser, locale, noa.session);
    try {
      await M.page.goto(`${WEB}/events/${id}`);
      const help = M.page.getByTestId('event-help');
      await help.waitFor();
      if (locale === 'he') {
        check(await M.page.getByTestId('hebrew-date').isVisible(), 'the Hebrew date is shown');
      }
      check(
        await M.page.getByRole('button', { name: t.eventShare.share }).isVisible(),
        'Share is offered',
      );
      await help.getByLabel(t.eventHelp.label).fill(text.help);
      await help.getByRole('button', { name: t.eventHelp.send }).click();
      await help.getByText(t.eventHelp.sent).waitFor();
      check(true, 'the urgent message was sent');
      await audit(M.page, `${locale}/event-help`);
      await help.scrollIntoViewIfNeeded();
      await shot(M.page, `${locale}/182-event-help`);
    } finally {
      await M.context.close();
    }

    // 2. The dashboard shows it first, highlighted, without who wrote; the admin answers.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/events`);
      await S.page.getByRole('button', { name: `${a.board} ${text.title}` }).click();
      await S.page.getByText(text.help).waitFor();
      const first = S.page.locator('section.board li.urgent-item').first();
      check(
        (await first.innerText()).includes(a.urgent),
        'the dashboard shows it first, marked as urgent',
      );
      const panel = await S.page.locator('section.board').innerText();
      check(!panel.includes(text.name) && !panel.includes(noa.email), 'never who wrote');
      await audit(S.page, `${locale}/admin-event-help`);
      await S.page.locator('section.board').scrollIntoViewIfNeeded();
      await shot(S.page, `${locale}/admin-11-event-help`);
      await S.page.getByLabel(a.answerLabel).fill(text.answer);
      await S.page.getByRole('button', { name: a.sendAnswer }).click();
      await S.page.getByText(a.answerSent).waitFor();
    } finally {
      await S.context.close();
    }

    // 3. The member sees the answer.
    const M2 = await open(browser, locale, noa.session);
    try {
      await M2.page.goto(`${WEB}/events/${id}`);
      await M2.page.getByText(text.answer, { exact: false }).waitFor();
      check(true, 'the member sees the answer');
    } finally {
      await M2.context.close();
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
process.stdout.write('\nHelp during an event: OK\n');
