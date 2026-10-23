// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Friends (phase 22) end to end in every language:
 * - Friends mode: two women interested in men find each other in the Friends deck and connect.
 * - Friends' takes: a member asks a friend; the friend writes it without an account; the member
 *   approves it; another member sees it on her profile.
 * - Double date: she invites her friend to pair up through a link; another pair is shown because
 *   all four can see each other; both pairs like each other; the group chat of four opens.
 * Usage: pnpm --dir e2e friends
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetRouteLimits,
  shot,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string, string, string]> = {
  en: ['Maya', 'Dana', 'Dan', 'Gil'],
  he: ['מאיה', 'דנה', 'דן', 'גיל'],
  ar: ['ليلى', 'سلمى', 'سامي', 'كريم'],
  ru: ['Маша', 'Даша', 'Дима', 'Глеб'],
};
const fill = (s: string, v: Record<string, string>) =>
  s.replace(/{{(\w+)}}/g, (_, k: string) => v[k] ?? '');

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function open(browser: Browser, locale: L, member: OnboardedMember | null) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
  });
  if (member) {
    await context.addCookies([
      {
        name: member.session.name,
        value: member.session.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const friendsOn = (m: OnboardedMember) =>
  m.call('PUT', '/v1/me/friend-mode', { on: true, ageMin: 18, ageMax: 100, genders: [] });

async function pairUp(a: OnboardedMember, b: OnboardedMember) {
  const { token } = await a.call<{ token: string }>('POST', '/v1/pairs/invite');
  return (await b.call<{ id: string }>('POST', `/v1/pairs/join/${token}`)).id;
}

async function run(browser: Browser, locale: L) {
  const t = T[locale];
  const [her, friend, him, buddy] = NAMES[locale];
  const maya = await onboardMember(`fr-${locale}`, her, 'woman', ['man']);
  const dana = await onboardMember(`fr-${locale}`, friend, 'woman', ['man']);
  const dan = await onboardMember(`fr-${locale}`, him, 'man', ['woman']);
  const gil = await onboardMember(`fr-${locale}`, buddy, 'man', ['woman']);

  const A = await open(browser, locale, maya);
  try {
    // 1. Friends mode, turned on in the app.
    await A.page.goto(`${WEB}/friend-mode`);
    await A.page.getByRole('checkbox', { name: t.friends.modeOn }).click();
    await shot(A.page, `${locale}/78-friend-mode`);
    await A.page.getByRole('button', { name: t.common.save }).click();
    await A.page.waitForURL((url) => !url.pathname.endsWith('/friend-mode'));
    await friendsOn(dana);
    await A.page.goto(`${WEB}/discover`);
    await A.page.getByRole('radio', { name: t.friends.decks.friend, exact: true }).click();
    const connect = A.page.getByRole('button', { name: new RegExp(t.friends.connect) });
    await connect.waitFor();
    check(
      await A.page.getByText(`${friend},`, { exact: false }).first().isVisible(),
      'the Friends deck shows Dana (not a dating candidate)',
    );
    await shot(A.page, `${locale}/79-friends-deck`);
    await dana.call('POST', '/v1/interactions', {
      targetId: maya.id,
      kind: 'like',
      mode: 'friend',
    });
    await connect.click();
    await A.page.getByText(fill(t.friends.matched, { name: friend })).waitFor();
    check(true, 'both connected in friends mode: a friends match');
    await A.page.goto(`${WEB}/matches`);
    await A.page.getByText(t.friends.label, { exact: true }).first().waitFor();
    check(true, 'the inbox labels it "Friends"');

    // 2. Friends' takes: ask, the friend writes without an account, approve.
    await A.page.goto(`${WEB}/takes`);
    await A.page.getByRole('button', { name: t.takes.ask }).click();
    const link = (await A.page.getByTestId('take-link').innerText()).trim();
    check(link.startsWith(`${WEB}/take/`), 'a one-time link for a friend');
    const F = await open(browser, locale, null);
    try {
      await F.page.goto(link);
      await F.page.getByLabel(t.takes.yourName).fill('Noor');
      await F.page
        .getByLabel(fill(t.takes.text, { name: her }))
        .fill('Generous, curious and the best at planning trips.');
      await shot(F.page, `${locale}/80-write-take`);
      await F.page.getByRole('button', { name: t.takes.send }).click();
      await F.page.getByText(fill(t.takes.thanks, { name: her })).waitFor();
      check(true, 'the friend wrote a take without an account');
    } finally {
      await F.context.close();
    }
    await A.page.reload();
    await A.page.getByRole('button', { name: t.takes.approve }).click();
    await A.page.getByTestId('take-approved').waitFor();
    await shot(A.page, `${locale}/81-takes`);
  } finally {
    await A.context.close();
  }

  const B = await open(browser, locale, dan);
  try {
    await B.page.goto(`${WEB}/profile/${maya.id}`);
    const takes = B.page.getByTestId('friend-takes');
    await takes.waitFor();
    check((await takes.innerText()).includes('Noor'), 'Dan sees the approved take on her profile');
    await takes.scrollIntoViewIfNeeded();
    await shot(B.page, `${locale}/82-profile-takes`);
  } finally {
    await B.context.close();
  }

  // 3. Double date: Maya invites Dana through a link; Dan and Gil are a pair too.
  const C = await open(browser, locale, maya);
  const D = await open(browser, locale, dana);
  try {
    await C.page.goto(`${WEB}/discover`);
    await C.page.getByRole('radio', { name: t.friends.decks.double, exact: true }).click();
    await C.page.getByRole('button', { name: t.pair.invite }).click();
    const pairLink = (await C.page.getByTestId('pair-link').innerText()).trim();
    await D.page.goto(pairLink);
    await D.page.getByRole('button', { name: t.pair.joinYes }).click();
    await D.page.getByText(fill(t.pair.joined, { name: her })).waitFor();
    check(true, 'Dana joined the pair through the link');
    await pairUp(dan, gil);

    await C.page.reload();
    await C.page.getByRole('radio', { name: t.friends.decks.double, exact: true }).click();
    const card = C.page.getByTestId('pair-card');
    await card.waitFor();
    check(
      (await card.innerText()).includes(him) && (await card.innerText()).includes(buddy),
      'Dan and Gil’s pair is shown (all four can see each other)',
    );
    await shot(C.page, `${locale}/83-pair-card`);
    await card.getByRole('button', { name: new RegExp(t.pair.like) }).click();
    const pairs = await gil.call<{ pairs: { id: string }[] }>('GET', '/v1/pairs/discover');
    const theirs = pairs.pairs[0]!.id;
    await gil.call('POST', `/v1/pairs/${theirs}/like`);
    // Maya sees the group chat in her inbox, live.
    await C.page.goto(`${WEB}/matches`);
    await C.page.getByTestId('double-chats').getByRole('button').first().click();
    await C.page.waitForURL((url) => url.pathname.startsWith('/double/'));
    const doubleId = C.page.url().split('/double/')[1]!.split(/[?#]/)[0]!;
    await C.page.getByLabel(t.chat.placeholder).fill('Hi all! Coffee on Friday?');
    await C.page.getByRole('button', { name: t.chat.send, exact: true }).click();
    await dan.call('POST', `/v1/doubles/${doubleId}/messages`, {
      text: 'Friday works for us!',
      clientId: `e2e-${locale}-${Date.now()}`,
    });
    await C.page
      .getByText('Friday works for us!')
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 15_000 });
    check(true, 'the group chat of four works live');
    const options = C.page.getByTestId('double-options');
    await options.click();
    await C.page.getByRole('button', { name: t.double.leave }).waitFor();
    let reports = 0;
    for (const name of [him, buddy, friend]) {
      const button = C.page.getByRole('button', {
        name: fill(t.double.report, { name }),
        exact: true,
      });
      if (await button.isVisible()) reports += 1;
    }
    check(reports === 3, 'the menu can report each of the other three');
    await options.click();
    await shot(C.page, `${locale}/84-double-chat`);
  } finally {
    await C.context.close();
    await D.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await pool.query('DELETE FROM rate_limit');
    // Earlier runs leave members in friends mode and in pairs; start each language from a clean deck.
    await pool.query('UPDATE preferences SET friend_mode = false WHERE friend_mode');
    await pool.query('UPDATE pairs SET ended_at = now() WHERE ended_at IS NULL');
    await resetRouteLimits();
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
