// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 61 end to end: a moderator suspends a member with an explanation; the member signs in,
 * reads why (the statement of reasons) and appeals; an admin reverses it in the dashboard; the
 * member is back, reads the reply, and was emailed (without the outcome).
 * Usage: pnpm --dir e2e appeals (API, web app and dashboard running)
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
  apiClient,
  audit,
  LOCALE_TAGS,
  locales,
  MAILPIT,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he } as const;
type L = keyof typeof T;
const STORY: Record<
  L,
  { names: [string, string]; explanation: string; appeal: string; reply: string }
> = {
  en: {
    names: ['Maya', 'Dan'],
    explanation: 'Three messages to another member called them names after they said no.',
    appeal: 'That was my brother using my phone at a party. I have changed my password since.',
    reply: 'Thank you for explaining. We withdrew the suspension; please keep your phone locked.',
  },
  he: {
    names: ['מאיה', 'דן'],
    explanation: 'שלוש הודעות לאדם אחר בקהילה כללו כינויי גנאי, אחרי סירוב להיפגש.',
    appeal: 'זה היה אח שלי, שלקח את הטלפון במסיבה. מאז החלפתי את הסיסמה.',
    reply: 'תודה על ההסבר. ההשעיה בוטלה; כדאי לנעול את הטלפון.',
  },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

/** A staff member with two-factor sign-in done over the API (the dashboard flow is in `safety`). */
async function staff(role: 'moderator' | 'admin', tag: string) {
  const email = `appeals-${role}-${tag}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = $2 WHERE email = $1`, [email, role]);
  const session = await signInHttp(email); // a session that carries the new role
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  desktop = false,
) {
  const context = await browser.newContext({
    viewport: desktop ? { width: 1280, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: desktop ? 1 : 2,
    locale: LOCALE_TAGS[locale],
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

async function mailSubjects(email: string): Promise<string[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  const list = (await res.json()) as { messages: { Subject: string; Snippet: string }[] };
  return list.messages.map((m) => `${m.Subject} ${m.Snippet}`);
}

await resetSignInLimits();
await pool.query(
  'INSERT INTO instance_settings (id, setup_completed_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET setup_completed_at = COALESCE(instance_settings.setup_completed_at, now())',
);
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale];
    const story = STORY[locale];
    const [herName, hisName] = story.names;
    // Earlier runs' appeals stay in the dashboard queue: close them, so this run's is the one shown.
    await pool.query(
      `UPDATE moderation_appeals SET status = 'upheld', decided_at = now() WHERE status = 'open'`,
    );
    const maya = await onboardMember(`appeals-${locale}`, herName, 'woman', ['man']);
    const dan = await onboardMember(`appeals-${locale}`, hisName, 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    await maya.call('POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    const { reportId } = await maya.call<{ reportId: string }>('POST', '/v1/reports', {
      targetId: dan.id,
      category: 'harassment',
      block: false,
    });
    const moderator = await staff('moderator', locale);
    await moderator.call('POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'suspend',
      reason: 'Internal: confirmed by the chat; first report.',
      ground: 'terms',
      explanation: story.explanation,
    });

    // ------------------------------------------------------------ member: why, and the appeal
    const back = await signInHttp(dan.email); // the suspension signed him out everywhere
    const D = await open(browser, locale, back);
    try {
      await D.page.goto(`${WEB}/`);
      await D.page.waitForURL((url) => url.pathname === '/suspended', { timeout: 20_000 });
      const card = D.page.getByTestId('decision-suspend');
      await card.waitFor();
      const text = await card.innerText();
      check(
        text.includes(t.decisions.action.suspend),
        'the suspended screen says what was decided',
      );
      check(text.includes(story.explanation), 'and why, in the moderator’s words');
      check(
        text.includes(
          t.decisions.groundTerms.replace('{{category}}', t.report.categories.harassment),
        ),
        'the ground and the category',
      );
      check(text.includes(t.decisions.byPerson), 'that a person decided');
      check(
        !text.includes('Internal:') && !text.includes(herName),
        'never the note or who reported',
      );
      await audit(D.page, `${locale}/decision-suspended`);
      await shot(D.page, `${locale}/139-decision-suspended`);

      const field = D.page.getByLabel(t.decisions.appealLabel);
      await D.page.getByRole('button', { name: t.decisions.appealSend }).click();
      await D.page.getByText(t.decisions.appealTooShort.replace('{{min}}', '10')).first().waitFor();
      check(true, 'an empty appeal is refused, with the reason read out');
      await field.fill(story.appeal);
      await D.page.getByRole('button', { name: t.decisions.appealSend }).click();
      await D.page.getByTestId('appeal-open').waitFor();
      check(true, 'the appeal is sent; the receipt is shown');
      await audit(D.page, `${locale}/appeal-sent`);
      await shot(D.page, `${locale}/140-appeal-sent`);
    } finally {
      await D.context.close();
    }

    // ------------------------------------------------------------ admin: decide in the dashboard
    const boss = await staff('admin', locale);
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/appeals`);
      await S.page.getByRole('heading', { name: a.appeals.title, level: 1 }).waitFor();
      const item = S.page.locator('article', { hasText: story.appeal });
      await item.waitFor();
      const shown = await item.innerText();
      check(
        shown.includes(story.explanation) && shown.includes('Internal:'),
        'the dashboard shows what the member was told and the internal note',
      );
      await item.getByRole('radio', { name: a.appeals.reverse }).check();
      await item.getByLabel(a.appeals.response).fill(story.reply);
      await audit(S.page, `${locale}/admin-appeals`);
      await shot(S.page, `${locale}/admin-30-appeals`);
      await item.getByRole('button', { name: new RegExp(a.detail.submit) }).click();
      await S.page.getByText(a.appeals.done).waitFor();
      check(true, 'an admin reverses it');
    } finally {
      await S.context.close();
    }

    // ------------------------------------------------------------ member: back, with the reply
    const after = await pool.query('SELECT status FROM "user" WHERE id = $1', [dan.id]);
    check(after.rows[0]?.status === 'active', 'the account is active again');
    const mails = await mailSubjects(dan.email);
    check(
      mails.some((m) => m.includes('appeal')) && !mails.some((m) => m.includes(story.reply)),
      'the member is emailed that the appeal was reviewed, without the reply',
    );
    const R = await open(browser, locale, back);
    try {
      await R.page.goto(`${WEB}/discover`);
      const notice = R.page.getByTestId('appeal-decided');
      await notice.waitFor({ timeout: 20_000 });
      check((await notice.innerText()).includes(t.decisions.appealReversed), 'a notice: accepted');
      await audit(R.page, `${locale}/appeal-decided`);
      await shot(R.page, `${locale}/141-appeal-decided`);
      await notice.getByRole('button', { name: t.decisions.noticeOpen }).click();
      await R.page.getByTestId('appeal-reply').waitFor();
      const page = await R.page.getByTestId('decision-suspend').innerText();
      check(
        page.includes(story.reply) && page.includes(t.decisions.reversed),
        'the decisions page shows the reply and that it was withdrawn',
      );
      await audit(R.page, `${locale}/decisions`);
      await shot(R.page, `${locale}/142-decisions`);
    } finally {
      await R.context.close();
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
process.stdout.write('\nDecisions and appeals: OK\n');
