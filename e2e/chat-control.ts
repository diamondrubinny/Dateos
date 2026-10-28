// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 30 end to end: replying to a message (the quote reaches the other person), unsending a
 * message (both see "Message unsent", live), and turning read receipts off.
 * Usage: pnpm --dir e2e chat-control
 */
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
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

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = {
  en: ['Maya', 'Dan'],
  he: ['מאיה', 'דן'],
  ar: ['ليلى', 'سامي'],
  ru: ['Маша', 'Дима'],
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
    const [herName, hisName] = NAMES[locale];
    const maya = await onboardMember(`control-${locale}`, herName, 'woman', ['man']);
    const dan = await onboardMember(`control-${locale}`, hisName, 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    const { matchId } = await maya.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    const question = locale === 'he' ? 'את אוהבת טיולים?' : 'Do you like hiking?';
    await dan.call('POST', `/v1/matches/${matchId}/messages`, {
      text: question,
      clientId: `e2e-q-${Date.now()}`,
    });
    const A = await open(browser, locale, maya);
    const B = await open(browser, locale, dan);
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await B.page.goto(`${WEB}/chat/${matchId}`);

    // 1. Maya replies to Dan's question, with the keyboard.
    const asked = await maya.call<{ messages: { id: string }[] }>(
      'GET',
      `/v1/matches/${matchId}/messages`,
    );
    const actions = A.page
      .getByTestId(`message-${asked.messages[0]!.id}`)
      .getByTestId('react-button');
    await actions.waitFor();
    await actions.focus();
    await A.page.keyboard.press('Enter');
    await A.page.getByRole('menuitem', { name: `↩ ${t.chatControl.reply}` }).click();
    await A.page.getByTestId('replying-to').waitFor();
    const answer = locale === 'he' ? 'מאוד! בשבת?' : 'Love it! Saturday?';
    await A.page.getByLabel(t.chat.messageLabel, { exact: true }).fill(answer);
    await audit(A.page, `${locale}/replying`);
    await A.page.getByRole('button', { name: t.chat.send, exact: true }).click();
    await A.page.getByTestId('replying-to').waitFor({ state: 'detached' });
    const quoteForDan = t.chatControl.replyingToYou.replace('{{text}}', question);
    await B.page.getByLabel(quoteForDan).waitFor({ timeout: 10_000 });
    check(true, 'Dan sees the reply with his question quoted');
    await shot(B.page, `${locale}/99-reply`);

    // 2. Maya unsends a message; both see "Message unsent", live.
    const oops = locale === 'he' ? 'אופס, לא לך' : 'Oops, wrong chat';
    await A.page.getByLabel(t.chat.messageLabel, { exact: true }).fill(oops);
    await A.page.getByRole('button', { name: t.chat.send, exact: true }).click();
    await B.page.getByText(oops).waitFor({ timeout: 10_000 });
    const sent = await maya.call<{ messages: { id: string; body: string | null }[] }>(
      'GET',
      `/v1/matches/${matchId}/messages`,
    );
    const oopsId = sent.messages.find((m) => m.body === oops)!.id;
    await A.page.getByTestId(`message-${oopsId}`).getByTestId('react-button').click();
    await A.page.getByRole('menuitem', { name: t.chatControl.unsend }).click();
    await A.page.getByText(t.chatControl.youUnsent).waitFor();
    await B.page.getByText(t.chatControl.unsent).waitFor({ timeout: 10_000 });
    check((await B.page.getByText(oops).count()) === 0, 'the text is gone for Dan too');
    await audit(B.page, `${locale}/unsent`);
    await shot(B.page, `${locale}/100-unsent`);

    // 3. Read receipts off: Dan stops seeing "Seen".
    await maya.call('PUT', '/v1/me/settings', { readReceipts: false });
    const settings = await A.context.newPage();
    await settings.goto(`${WEB}/settings`);
    const box = settings.getByRole('checkbox', { name: t.chatControl.receiptsLabel });
    await box.scrollIntoViewIfNeeded();
    check((await box.getAttribute('aria-checked')) === 'false', 'Settings shows read receipts off');
    await settings.close();
    const page = await dan.call<{ otherReadAt: string | null }>(
      'GET',
      `/v1/matches/${matchId}/messages`,
    );
    check(page.otherReadAt === null, 'Dan no longer sees when Maya read');

    // Search in the chat (phase 32): finds the reply, never the unsent message.
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByTestId('search-chat').click();
    const search = A.page.getByTestId('chat-search');
    const term = locale === 'he' ? 'בשבת' : 'Saturday';
    await search.getByLabel(t.chatSearch.label).fill(term);
    await search.getByText(t.chatSearch.found.replace('{{count}}', '1')).waitFor();
    check((await search.getByText(answer).count()) === 1, 'search finds the reply');
    await search.getByLabel(t.chatSearch.label).fill(oops.slice(0, 6));
    await search.getByText(t.chatSearch.none).waitFor();
    check(true, 'search never finds the unsent message');
    await audit(A.page, `${locale}/chat-search`);

    // 4. Mute and archive (phase 31): private, and a new message brings the chat back.
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByTestId('mute-chat').click();
    await A.page.getByText(`🔕 ${t.chatPrefs.unmute}`).waitFor();
    await A.page.getByTestId('archive-chat').click();
    await A.page.goto(`${WEB}/matches`);
    const toggle = A.page.getByTestId('archived-toggle');
    await toggle.waitFor();
    check(
      (await A.page.getByText(hisName, { exact: true }).count()) === 0,
      'the archived chat left the list',
    );
    await toggle.click();
    await A.page.getByText(`🔕 ${t.chatPrefs.muted}`).waitFor();
    check(true, 'it is under Archived, marked muted');
    await audit(A.page, `${locale}/archived`);
    await shot(A.page, `${locale}/102-archived`);
    const danSees = await dan.call<{ conversations: { muted: boolean; archived: boolean }[] }>(
      'GET',
      '/v1/conversations',
    );
    check(
      danSees.conversations.every((c) => !c.muted && !c.archived),
      'Dan sees nothing of it',
    );
    await dan.call('POST', `/v1/matches/${matchId}/messages`, {
      text: locale === 'he' ? 'עדיין פה?' : 'Still there?',
      clientId: `e2e-back-${Date.now()}`,
    });
    const back = await maya.call<{ conversations: { archived: boolean }[] }>(
      'GET',
      '/v1/conversations',
    );
    check(back.conversations[0]?.archived === false, 'a new message brought the chat back');
    await A.context.close();
    await B.context.close();
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nChat control: OK\n');
