// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 41 end to end, with real email through Mailpit: change the account's address in
 * Settings → Security, confirm with the link sent to the new address, and check that the old
 * address got a heads-up without a link.
 * Usage: pnpm --dir e2e change-email
 */
import { chromium, type Browser } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ltr } from '../apps/mobile/src/lib/bidi.ts';
import {
  audit,
  LOCALE_TAGS,
  locales,
  MAILPIT,
  magicLink,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const T = { en, he } as const;
type L = keyof typeof T;

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

/** The heads-up to the old address: found by subject, with no link in it. */
async function headsUp(to: string): Promise<{ text: string } | null> {
  for (let i = 0; i < 40; i += 1) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as { messages: { ID: string; Subject: string }[] };
    const hit = list.messages.find((m) => m.Subject.includes('Email change requested'));
    if (hit) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as {
        Text: string;
      };
      return { text: message.Text };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const maya = await onboardMember(
      `email-${locale}`,
      locale === 'he' ? 'מאיה' : 'Maya',
      'woman',
      ['man'],
    );
    const oldEmail = maya.email;
    const newEmail = `maya-new-${locale}-${Date.now()}@example.test`;
    const A = await open(browser, locale, maya);
    try {
      // 1. Settings → Security → Email address → Change email.
      await A.page.goto(`${WEB}/settings`);
      const card = A.page.getByTestId('email-address');
      await card.scrollIntoViewIfNeeded();
      check((await card.innerText()).includes(oldEmail), 'Settings shows the current address');
      await card.getByRole('button', { name: t.changeEmail.open }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/change-email'));
      await A.page.getByLabel(t.changeEmail.label, { exact: true }).fill(newEmail);
      await A.page.getByRole('button', { name: t.changeEmail.send }).click();
      await A.page.getByText(fill(t.changeEmail.sent, { email: ltr(newEmail) })).waitFor();
      await audit(A.page, `${locale}/change-email`);
      await shot(A.page, `${locale}/113-change-email`);

      // 2. The old address hears about it, without a link.
      const notice = await headsUp(oldEmail);
      check(notice !== null, 'the old address got a heads-up');
      check(!/https?:\/\/\S*token/.test(notice?.text ?? ''), 'the heads-up has no link');

      // 3. The link from the new mailbox confirms it, in the same signed-in browser.
      const link = await magicLink(newEmail);
      check(link.includes('/confirm-email?token='), 'the new address got a confirmation link');
      await A.page.goto(link);
      await A.page.getByText(fill(t.changeEmail.done, { email: ltr(newEmail) })).waitFor();
      await audit(A.page, `${locale}/confirm-email`);
      await shot(A.page, `${locale}/114-email-confirmed`);
      const me = await maya.call<{ user: { email: string } }>('GET', '/v1/me');
      check(me.user.email === newEmail, 'the account now uses the new address');

      // 4. The same link can't be used twice.
      await A.page.goto(link);
      await A.page.getByText(t.changeEmail.expired).waitFor();
      check(true, 'a used link says it has expired');
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
process.stdout.write('\nChange email: OK\n');
