// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 66b end to end: a member writes a Match Note on the profile tab; a match sees it on the
 * profile card; a stranger doesn't get it.
 * Usage: pnpm --dir e2e match-note (API, worker and web app running)
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
const STORY: Record<L, { names: [string, string, string]; note: string }> = {
  en: {
    names: ['Noa', 'Dan', 'Eli'],
    note: 'I use a wheelchair, so I pick places with step-free access. Happy to talk about it.',
  },
  he: {
    names: ['נועה', 'דן', 'אלי'],
    note: 'אני בכיסא גלגלים, אז אני בוחרת מקומות נגישים. אשמח לדבר על זה.',
  },
};

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

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const story = STORY[locale];
    const [noaName, danName, eliName] = story.names;
    const noa = await onboardMember(`note-${locale}`, noaName, 'woman', ['man']);
    const dan = await onboardMember(`note-${locale}`, danName, 'man', ['woman']);
    const eli = await onboardMember(`note-${locale}`, eliName, 'man', ['woman']);

    // ---------------------------------------------------------- Noa writes her note
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/profile`);
      await N.page.getByRole('button', { name: t.matchNote.title }).click();
      const box = N.page.getByRole('textbox', { name: t.matchNote.label });
      await box.waitFor({ timeout: 20_000 });
      await box.fill(story.note);
      await audit(N.page, `${locale}/match-note-edit`);
      await shot(N.page, `${locale}/153-match-note-edit`);
      await N.page.getByRole('button', { name: t.common.save }).click();
      let saved: string | null = null;
      for (let i = 0; i < 40 && saved !== story.note; i += 1) {
        saved = (await noa.call<{ matchNote: string | null }>('GET', '/v1/me')).matchNote;
        if (saved !== story.note) await N.page.waitForTimeout(250);
      }
      check(saved === story.note, 'the member writes a note for matches');
    } finally {
      await N.context.close();
    }

    // ---------------------------------------------------------- a stranger, then a match
    const stranger = await eli.call<{ matchNote?: string | null }>('GET', `/v1/profiles/${noa.id}`);
    check(!stranger.matchNote, 'a stranger doesn’t get it');
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await noa.call('POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/profile/${noa.id}`);
      const card = D.page.getByTestId('match-note');
      await card.waitFor({ timeout: 20_000 });
      const text = await card.innerText();
      check(
        text.includes(story.note) && text.includes(fill(t.matchNote.cardTitle, { name: noaName })),
        'a match sees it on the profile card',
      );
      await card.scrollIntoViewIfNeeded();
      await audit(D.page, `${locale}/match-note-card`);
      await shot(D.page, `${locale}/154-match-note-card`);
    } finally {
      await D.context.close();
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
process.stdout.write('\nMatch Note: OK\n');
