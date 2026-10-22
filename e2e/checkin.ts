// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Safety check-in and anti-ghosting end to end, in every language: a member sets up a check-in
 * from the app, presses SOS (the trusted contact's email is checked in Mailpit), ends it with
 * "I'm OK", then closes a conversation kindly and the other person sees the card live.
 */
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { demoPhoto } from './demo-images.ts';
import {
  apiClient,
  LOCALE_TAGS,
  locales,
  MAILPIT,
  reportA11y,
  shot,
  showcase,
  signInHttp,
  WEB,
} from './lib.ts';

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const PEOPLE = {
  en: { a: 'Maya', b: 'Ari', place: 'Café Puaa, Jaffa' },
  he: { a: 'מאיה', b: 'אורי', place: 'קפה פועה, יפו' },
  ar: { a: 'ليلى', b: 'كريم', place: 'مقهى بوعا، يافا' },
  ru: { a: 'Анна', b: 'Илья', place: 'Кафе «Пуа», Яффо' },
} as const;
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function account(email: string, name: string, gender: 'woman' | 'man') {
  const session = await signInHttp(email);
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
    interestedIn: [gender === 'woman' ? 'man' : 'woman'],
    intention: 'long_term',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: 'The sea, then coffee.' }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto(gender === 'woman' ? 'sunset' : 'mountains'))], {
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
  return { context, page: await context.newPage() };
}

async function mailTo(address: string): Promise<{ Subject: string; Text: string } | null> {
  for (let i = 0; i < 40; i += 1) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
    ).json()) as { messages: { ID: string }[] };
    const id = list.messages[0]?.ID;
    if (id) return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as never;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function run(locale: L, browser: Browser) {
  const t = T[locale];
  const p = PEOPLE[locale];
  const stamp = Date.now();
  // A fixed, readable address for the screenshots; earlier runs' mail to it is cleared first.
  const contact = 'dana@example.org';
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${contact}"`)}`, {
    method: 'DELETE',
  });
  const a = await account(`checkin-a-${locale}-${stamp}@example.test`, p.a, 'woman');
  const b = await account(`checkin-b-${locale}-${stamp}@example.test`, p.b, 'man');
  await b.call('POST', '/v1/interactions', { targetId: a.id, kind: 'like' });
  const { matchId } = await a.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: b.id,
    kind: 'like',
  });
  await b.call('POST', `/v1/matches/${matchId}/messages`, { text: '👋', clientId: `h-${stamp}` });

  const A = await open(browser, a.session, locale);
  const B = await open(browser, b.session, locale);
  try {
    // --- Safety check-in -------------------------------------------------------------
    await A.page.goto(`${WEB}/checkin`);
    await A.page.getByRole('radio', { name: p.b, exact: true }).click();
    await A.page.getByLabel(t.checkin.place, { exact: true }).fill(p.place);
    await A.page.getByRole('radio', { name: t.checkin.d3, exact: true }).click();
    await A.page.getByLabel(t.checkin.contactName, { exact: true }).fill('Dana');
    await A.page.getByLabel(t.checkin.contactEmail, { exact: true }).fill(contact);
    await A.page.getByLabel(t.checkin.place, { exact: true }).scrollIntoViewIfNeeded();
    await shot(A.page, `${locale}/40-checkin-form`);
    await A.page.getByRole('button', { name: t.checkin.create }).click();
    await A.page.getByText(t.checkin.activeTitle).waitFor();
    await shot(A.page, `${locale}/41-checkin-active`);
    check((await mailTo(contact)) === null, 'nothing is emailed when the check-in starts');

    await A.page.getByRole('button', { name: t.checkin.sos }).click();
    await A.page.getByRole('button', { name: t.checkin.sosConfirm }).click();
    await A.page.getByText(t.checkin.sosSent.replace('{{name}}', 'Dana')).waitFor();
    const mail = await mailTo(contact);
    check(
      Boolean(mail?.Subject.includes('SOS')),
      `SOS email reached the contact (${mail?.Subject})`,
    );
    check(Boolean(mail?.Text.includes(p.place)), 'the email quotes the place the member wrote');
    check(Boolean(mail?.Text.includes(p.b)), 'the email names the match');
    await A.page.getByRole('button', { name: t.checkin.ok }).click();
    await A.page.getByText(t.checkin.okDone).waitFor();
    check(true, '"I\'m OK" ends the check-in');

    // --- Close kindly ------------------------------------------------------------------
    await B.page.goto(`${WEB}/matches`);
    await B.page.getByText(p.a).first().waitFor();
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByRole('button', { name: t.ghosting.closeKindly }).click();
    await A.page.getByText(t.ghosting.closeTitle).first().waitFor();
    await shot(A.page, `${locale}/42-close-kindly`);
    await A.page.getByRole('button', { name: t.ghosting.send }).click();
    await A.page.waitForURL(/\/matches/);
    const card = B.page.getByText(t.ghosting.closedCard.replace('{{name}}', p.a));
    await card.waitFor({ timeout: 10_000 });
    check(true, 'the other person sees the closed card live');
    check(
      await B.page.getByText(t.ghosting.template1, { exact: false }).isVisible(),
      'the card shows the kind message',
    );
    await shot(B.page, `${locale}/43-closed-card`);
  } finally {
    await A.context.close();
    await B.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser);
    await showcase(
      `showcase-safety-date-${locale}`,
      ['40-checkin-form', '41-checkin-active', '42-close-kindly', '43-closed-card'].map(
        (n) => `${locale}/${n}`,
      ),
    );
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length) {
  process.stdout.write(`\n${problems.length} check(s) failed\n`);
  process.exitCode = 1;
}
