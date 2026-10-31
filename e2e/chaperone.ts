// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 68d end to end: a member invites a chaperone; the chaperone joins; the member's match
 * sees the notice in the chat; the chaperone reads a new message (not one from before); the
 * member removes the chaperone and access ends.
 * Usage: pnpm --dir e2e chaperone (API, worker and web app running)
 */
import { chromium, type Browser } from 'playwright';
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
} from './lib.ts';

const T = { en, he } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string, string]> = {
  en: ['Amira', 'Yusuf', 'Fatima'],
  he: ['אמירה', 'יוסף', 'פאטמה'],
};
const BEFORE: Record<L, string> = { en: 'Hello from before', he: 'שלום מלפני' };
const AFTER: Record<L, string> = { en: 'Shall we meet on Friday?', he: 'ניפגש ביום שישי?' };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

async function open(browser: Browser, locale: L, session: { name: string; value: string }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

let n = 0;
await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [amiraName, yusufName, fatimaName] = NAMES[locale];
    const amira = await onboardMember(`wali-${locale}`, amiraName, 'woman', ['man']);
    const yusuf = await onboardMember(`wali-${locale}`, yusufName, 'man', ['woman']);
    const fatima = await onboardMember(`wali-${locale}`, fatimaName, 'woman', ['man']);
    await yusuf.call('POST', '/v1/interactions', { targetId: amira.id, kind: 'like' });
    const { matchId } = await amira.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: yusuf.id,
      kind: 'like',
    });
    const say = (m: typeof yusuf, text: string) =>
      m.call('POST', `/v1/matches/${matchId}/messages`, {
        clientId: `msg-e2e-${(n += 1)}-${Date.now()}`,
        text,
      });
    await say(yusuf, BEFORE[locale]);

    // ---------------------------------------------------------- Amira invites Fatima
    const A = await open(browser, locale, amira.session);
    let url = '';
    try {
      await A.page.goto(`${WEB}/settings`);
      const invite = A.page.getByRole('button', { name: t.chaperone.invite });
      await invite.waitFor({ timeout: 20_000 });
      await invite.scrollIntoViewIfNeeded();
      await invite.click();
      const link = A.page.getByTestId('chaperone-link');
      await link.waitFor({ timeout: 20_000 });
      url = /https?:\/\/\S+\/chaperone\/\S+/.exec(await link.innerText())?.[0] ?? '';
      check(url.includes('/chaperone/'), 'the member invites a chaperone with a one-time link');
      await A.page.getByTestId('chaperone-settings').scrollIntoViewIfNeeded();
      await audit(A.page, `${locale}/chaperone-settings`);
      await shot(A.page, `${locale}/170-chaperone-settings`);
    } finally {
      await A.context.close();
    }

    // ---------------------------------------------------------- Fatima accepts
    const F = await open(browser, locale, fatima.session);
    try {
      await F.page.goto(url.replace(/^https?:\/\/[^/]+/, WEB));
      const accept = F.page.getByRole('button', {
        name: fill(t.chaperone.accept, { name: amiraName }),
      });
      await accept.waitFor({ timeout: 20_000 });
      await audit(F.page, `${locale}/chaperone-join`);
      await accept.click();
      await F.page.getByTestId('chaperoned-member').waitFor({ timeout: 20_000 });
      check(true, 'the chaperone accepts');
    } finally {
      await F.context.close();
    }
    await say(yusuf, AFTER[locale]);

    // ---------------------------------------------------------- Yusuf sees the notice
    const Y = await open(browser, locale, yusuf.session);
    try {
      await Y.page.goto(`${WEB}/chat/${matchId}`);
      const notice = Y.page.getByTestId('chaperone-notice');
      await notice.waitFor({ timeout: 20_000 });
      const text = await notice.innerText();
      check(
        text.includes(amiraName) && text.includes(fatimaName),
        'the other side of the chat sees that a chaperone reads it, and who',
      );
      await audit(Y.page, `${locale}/chaperone-notice`);
      await shot(Y.page, `${locale}/171-chaperone-notice`);
    } finally {
      await Y.context.close();
    }

    // ---------------------------------------------------------- Fatima reads, from today on
    const F2 = await open(browser, locale, fatima.session);
    try {
      await F2.page.goto(`${WEB}/chaperoning/${amira.id}/${matchId}`);
      const first = F2.page.getByTestId('transcript-message').first();
      await first.waitFor({ timeout: 20_000 });
      const all = (await F2.page.getByTestId('transcript-message').allInnerTexts()).join('\n');
      check(
        all.includes(AFTER[locale]) && !all.includes(BEFORE[locale]),
        'the chaperone reads what came after joining, not before',
      );
      check((await F2.page.getByRole('textbox').count()) === 0, 'read-only: nowhere to write');
      await audit(F2.page, `${locale}/chaperone-transcript`);
      await shot(F2.page, `${locale}/172-chaperone-transcript`);
    } finally {
      await F2.context.close();
    }

    // ---------------------------------------------------------- Amira removes her
    const A2 = await open(browser, locale, amira.session);
    try {
      await A2.page.goto(`${WEB}/settings`);
      const remove = A2.page.getByRole('button', {
        name: fill(t.chaperone.remove, { name: fatimaName }),
      });
      await remove.waitFor({ timeout: 20_000 });
      await remove.scrollIntoViewIfNeeded();
      await remove.click();
      await A2.page.getByRole('button', { name: t.chaperone.removeYes, exact: true }).click();
      await A2.page.getByRole('button', { name: t.chaperone.invite }).waitFor({ timeout: 20_000 });
    } finally {
      await A2.context.close();
    }
    const gone = await fetch(
      `${process.env.API_URL ?? 'http://localhost:4000'}/v1/chaperoning/${amira.id}/${matchId}`,
      { headers: { cookie: fatima.session.header } },
    );
    check(gone.status === 404, 'after removing, the chaperone has no access');
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nChaperone: OK\n');
