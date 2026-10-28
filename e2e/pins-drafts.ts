// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 38 end to end: pin a chat to the top of Matches (up to 3), and a message typed but not
 * sent stays as a draft on this device ("Draft: …" in Matches) until sign-out.
 * Usage: pnpm --dir e2e pins-drafts
 */
import { MAX_PINNED_CHATS } from '@nexaheart/shared';
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
  type OnboardedMember,
} from './lib.ts';

const T = { en, he } as const;
type L = keyof typeof T;
const NAMES: Record<L, string[]> = {
  en: ['Maya', 'Dan', 'Eli', 'Gil', 'Omer'],
  he: ['מאיה', 'דן', 'אלי', 'גיל', 'עומר'],
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

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [herName, ...men] = NAMES[locale];
    const maya = await onboardMember(`pins-${locale}`, herName!, 'woman', ['man']);
    // Four matches; each man writes, the first one earliest.
    const chats: { name: string; id: string }[] = [];
    for (const name of men) {
      const m = await onboardMember(`pins-${locale}`, name, 'man', ['woman']);
      await m.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
      const { matchId } = await maya.call<{ matchId: string }>('POST', '/v1/interactions', {
        targetId: m.id,
        kind: 'like',
      });
      await m.call('POST', `/v1/matches/${matchId}/messages`, {
        text: locale === 'he' ? 'היי! מה שלומך?' : 'Hi! How are you?',
        clientId: `pins-${locale}-${matchId}`,
      });
      chats.push({ name, id: matchId });
    }
    const first = chats[0]!;
    const A = await open(browser, locale, maya);
    try {
      // 1. Pin the oldest chat and leave a draft in it.
      await A.page.goto(`${WEB}/chat/${first.id}`);
      await A.page.getByTestId('pin-chat').click();
      await A.page.getByText(`📌 ${t.chatPrefs.unpin}`).waitFor();
      const draft = locale === 'he' ? 'רציתי לשאול לגבי שבת' : 'I wanted to ask about Saturday';
      await A.page.getByLabel(t.chat.messageLabel, { exact: true }).fill(draft);
      await A.page.waitForTimeout(800); // saved after a short pause in typing

      await A.page.goto(`${WEB}/matches`);
      const list = A.page.getByText(fill(t.chat.draft, { text: draft }));
      await list.waitFor();
      check(true, 'Matches shows the draft');
      const body = await A.page.locator('body').innerText();
      const at = (name: string) => body.indexOf(name);
      check(
        men.slice(1).every((name) => at(first.name) < at(name)),
        'the pinned chat comes first',
      );
      check(body.includes(`📌 ${t.chatPrefs.pinned}`), 'it is marked "Pinned" in words');
      await audit(A.page, `${locale}/pinned-draft`);
      await shot(A.page, `${locale}/110-pinned-draft`);

      // 2. The draft is back in the chat after a reload.
      await A.page.goto(`${WEB}/chat/${first.id}`);
      const box = A.page.getByLabel(t.chat.messageLabel, { exact: true });
      await A.page.waitForFunction(
        (text) =>
          [...document.querySelectorAll('textarea')].some(
            (el) => (el as HTMLTextAreaElement).value === text,
          ),
        draft,
      );
      check((await box.inputValue()) === draft, 'the draft is restored in the chat');

      // 3. A fourth pin is refused politely.
      for (const c of chats.slice(1, MAX_PINNED_CHATS)) {
        await maya.call('PUT', `/v1/matches/${c.id}/prefs`, { pinned: true });
      }
      await A.page.goto(`${WEB}/chat/${chats[MAX_PINNED_CHATS]!.id}`);
      await A.page.getByTestId('pin-chat').click();
      await A.page.getByText(fill(t.chatPrefs.pinLimit, { count: MAX_PINNED_CHATS })).waitFor();
      check(true, `a ${MAX_PINNED_CHATS + 1}th pin asks to unpin one first`);

      // 4. Drafts never leave the device, and sign-out removes them.
      const stored = await A.page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('nexaheart.draft')),
      );
      check(stored.length === 2, `the draft is in this browser only (${stored.join(', ')})`);
      await A.page.goto(`${WEB}/settings`);
      await A.page.getByRole('button', { name: t.settings.signOut }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/welcome'));
      const left = await A.page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('nexaheart.draft')),
      );
      check(left.length === 0, 'sign-out removes every draft');
    } finally {
      await A.context.close();
    }
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nPinned chats and drafts: OK\n');
