/**
 * Phase 4 end to end, in real browsers: a member reports a scammer from the chat and verifies
 * their photos; a staff member signs in to the moderation dashboard with TOTP, reviews the
 * report and the selfie, and acts. Captures screenshots and an axe-core audit of every screen.
 */
import { existsSync } from 'node:fs';
import { createDb, schema } from '@dateos/db';
import { eq } from 'drizzle-orm';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { demoPhoto } from './demo-images.ts';
import { apiClient, magicLink, reportA11y, shot, showcase, signInHttp, WEB } from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const LEGAL = { terms: '2026-10', privacy: '2026-10' };
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const people = {
  en: {
    reporter: { name: 'Lia', gender: 'woman', interestedIn: ['man'], scene: 'sunset' },
    reported: { name: 'Max', gender: 'man', interestedIn: ['woman'], scene: 'mountains' },
    scam: 'I am stuck abroad, can you send me money with a gift card? I will pay you back',
    hello: 'Hi Lia! Loved your beach photo',
    reply: 'Hi Max, thanks!',
    details: 'He asked me for gift cards after two messages.',
    action: 'suspend' as const,
  },
  he: {
    reporter: { name: 'שירה', gender: 'woman', interestedIn: ['man'], scene: 'sunset' },
    reported: { name: 'רון', gender: 'man', interestedIn: ['woman'], scene: 'mountains' },
    scam: 'אני תקוע בחו״ל, תוכלי להעביר לי כסף בגיפט קארד? אחזיר לך',
    hello: 'היי! אהבתי את התמונה מהחוף',
    reply: 'היי, תודה!',
    details: 'ביקש ממני גיפט קארד אחרי שתי הודעות.',
    action: 'warn' as const,
  },
} as const;

type Person = (typeof people)['en']['reporter'];

async function createAccount(email: string, p: Person) {
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  await call('POST', '/v1/me/profile', {
    displayName: p.name,
    birthDate: '1994-03-03',
    gender: p.gender,
    interestedIn: p.interestedIn,
    intention: 'long_term',
    bio: 'Sea, coffee and good conversations.',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: LEGAL.terms },
      { kind: 'privacy', granted: true, version: LEGAL.privacy },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  await call('PUT', '/v1/me/location', { lat: 32.0809, lng: 34.7806 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'green_flag', answer: 'Kindness first' }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto(p.scene))], { type: 'image/jpeg' }),
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

async function browserFor(
  browser: Browser,
  locale: string,
  cookie?: { name: string; value: string },
) {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale,
  });
  if (cookie) {
    await context.addCookies([
      {
        name: cookie.name,
        value: cookie.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  await context.addInitScript(
    (l) => {
      localStorage.setItem('dateos.locale', l);
      localStorage.setItem('dateos-admin-locale', l);
    },
    locale.slice(0, 2),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => process.stderr.write(`pageerror: ${e.message}\n`));
  return { context, page };
}

async function run(locale: 'en' | 'he', browser: Browser) {
  const s = people[locale];
  const t = locale === 'he' ? he : en;
  const a = adminMessages[locale];
  const stamp = Date.now();
  const { db, pool } = createDb(process.env.DATABASE_URL ?? '');
  // All browsers share one IP here, so the per-IP sign-in limit (local dev DB only) is reset.
  const resetSignInLimit = () => pool.query('DELETE FROM rate_limit');
  await resetSignInLimit();
  // Leftovers from an earlier, interrupted run of this script (fictional e2e accounts only).
  await pool.query(`DELETE FROM "user" WHERE email LIKE 'safety-%@example.test'`);
  const reporter = await createAccount(`safety-a-${locale}-${stamp}@example.test`, s.reporter);
  const reported = await createAccount(`safety-b-${locale}-${stamp}@example.test`, s.reported);
  await reported.call('POST', '/v1/interactions', { targetId: reporter.id, kind: 'like' });
  const { matchId } = await reporter.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: reported.id,
    kind: 'like',
  });
  const say = (who: typeof reporter, text: string) =>
    who.call('POST', `/v1/matches/${matchId}/messages`, {
      text,
      clientId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  await say(reported, s.hello);
  await say(reporter, s.reply);
  await say(reported, s.scam);

  // Staff member: a normal account, promoted by the operator (here: directly in the DB, like the CLI).
  const staffEmail = `safety-admin-${locale}-${stamp}@example.test`;
  await signInHttp(staffEmail); // creates the account the operator then promotes
  await db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.email, staffEmail));

  const L = locale === 'he' ? 'he-IL' : 'en-US';
  const A = await browserFor(browser, L, reporter.session);
  const B = await browserFor(browser, L, reported.session);
  const S = await browserFor(browser, L);
  S.page.setViewportSize({ width: 1280, height: 860 });
  try {
    // ------------------------------------------------------------ member: report from the chat
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByText(s.scam).first().waitFor();
    await A.page
      .getByRole('button', { name: t.report.openLabel.replace('{{name}}', s.reported.name) })
      .click();
    await A.page.getByText(t.report.category).first().waitFor();
    await shot(A.page, `${locale}/24-report`);
    await A.page.getByRole('button', { name: t.report.submit }).click();
    await A.page.getByText(t.report.pickCategory).first().waitFor(); // validation: category required
    await A.page.getByRole('radio', { name: t.report.categories.scam }).click();
    await A.page.getByLabel(t.report.details).fill(s.details);
    await shot(A.page, `${locale}/25-report-filled`);
    await A.page.getByRole('button', { name: t.report.submit }).click();
    await A.page.getByText(t.report.done).waitFor();
    await shot(A.page, `${locale}/26-report-sent`);

    // ------------------------------------------------------------ member: photo verification
    await A.page.goto(`${WEB}/verify`);
    await A.page.getByRole('button', { name: t.verify.start }).click();
    await A.page.getByText(t.verify.pose.split('{{')[0]!.trim()).first().waitFor();
    await shot(A.page, `${locale}/27-verify-pose`);
    const chooser = A.page.waitForEvent('filechooser');
    await A.page.getByRole('button', { name: t.verify.choose }).click();
    await (
      await chooser
    ).setFiles({
      name: 'selfie.jpg',
      mimeType: 'image/jpeg',
      buffer: await demoPhoto(s.reporter.scene),
    });
    await A.page.getByText(t.verify.pending).waitFor({ timeout: 30_000 });
    await shot(A.page, `${locale}/28-verify-pending`);

    // ------------------------------------------------------------ staff: sign in + TOTP
    const res = await fetch(`${ADMIN}/`);
    assert(
      res.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"),
      'admin CSP',
    );
    await resetSignInLimit();
    await S.page.goto(`${ADMIN}/`);
    await S.page.getByLabel(a.signIn.email).fill(staffEmail);
    await shot(S.page, `${locale}/admin-01-sign-in`);
    await S.page.getByRole('button', { name: a.signIn.submit }).click();
    await S.page.getByText(a.signIn.sent).waitFor();
    await S.page.goto(await magicLink(staffEmail)); // the emailed link, opened in this browser
    await S.page.getByRole('button', { name: a.mfa.start }).click();
    await S.page.getByRole('img', { name: a.mfa.qrAlt }).waitFor();
    const secret = (await S.page.locator('code.secret').innerText()).replace(/\s/g, '');
    await shot(S.page, `${locale}/admin-02-mfa-setup`);
    await S.page.getByLabel(a.mfa.code).fill('000000');
    await S.page.getByRole('button', { name: a.mfa.submit }).click();
    await S.page.getByText(a.mfa.invalid).waitFor(); // a wrong code is refused
    await S.page.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
    await S.page.getByRole('button', { name: a.mfa.submit }).click();

    // ------------------------------------------------------------ staff: report queue + decision
    await S.page.getByRole('heading', { name: a.reports.title }).waitFor();
    await S.page.getByText(s.reported.name).first().waitFor();
    await shot(S.page, `${locale}/admin-03-reports`);
    await S.page
      .getByRole('link', { name: new RegExp(a.reports.view) })
      .first()
      .click();
    await S.page.getByText(s.scam).waitFor();
    await S.page.getByText(s.details).waitFor();
    await S.page.locator('img.photo').first().waitFor();
    await shot(S.page, `${locale}/admin-04-report-detail`);
    await S.page.getByRole('radio', { name: a.actions[s.action] }).check();
    await S.page
      .getByLabel(a.detail.reason)
      .fill('Gift-card scam pattern; confirmed by chat evidence.');
    if (s.action === 'suspend') await S.page.getByLabel(a.detail.confirm).check();
    await S.page.getByRole('button', { name: new RegExp(a.detail.submit) }).click();
    await S.page.getByText(a.detail.done).waitFor();
    await shot(S.page, `${locale}/admin-05-report-resolved`);

    // ------------------------------------------------------------ staff: verification
    await S.page.getByRole('link', { name: a.nav.verifications }).click();
    await S.page.getByText(s.reporter.name).first().waitFor();
    await S.page.locator('img.photo.large').waitFor();
    await shot(S.page, `${locale}/admin-06-verification`);
    await S.page.getByRole('button', { name: new RegExp(a.verify.approve) }).click();
    await S.page.getByText(a.verify.decided).waitFor();

    await S.page.getByRole('link', { name: a.nav.audit }).click();
    await S.page.getByText('moderation.').first().waitFor();
    await shot(S.page, `${locale}/admin-07-audit`);

    // ------------------------------------------------------------ outcomes for both members
    await A.page.goto(`${WEB}/verify`);
    await A.page.getByText(t.verify.approved).first().waitFor();
    await shot(A.page, `${locale}/29-verify-approved`);

    if (s.action === 'warn') {
      await B.page.goto(`${WEB}/discover`);
      await B.page.getByText(t.account.warningTitle).waitFor();
      await shot(B.page, `${locale}/30-warning`);
      await B.page.getByRole('button', { name: t.account.warningAck }).click();
      await B.page.getByText(t.account.warningTitle).waitFor({ state: 'detached' });
    } else {
      // Suspension signed the member out; signing in again shows only the suspension screen.
      await resetSignInLimit();
      const again = await signInHttp(`safety-b-${locale}-${stamp}@example.test`);
      await B.context.addCookies([
        {
          name: again.name,
          value: again.value,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      await B.page.goto(`${WEB}/`);
      await B.page.getByText(t.account.suspendedTitle).first().waitFor();
      await shot(B.page, `${locale}/30-suspended`);
      await B.page.goto(`${WEB}/discover`);
      await B.page.getByText(t.account.suspendedTitle).first().waitFor(); // tabs redirect too
    }

    // The selfie was deleted after the decision.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM photos WHERE user_id = $1 AND purpose = 'verification'`,
      [reporter.id],
    );
    assert(rows[0].n === 0, 'selfie deleted after decision');
  } catch (error) {
    const dir = process.env.FAILURE_DIR ?? '/tmp';
    for (const [n, p] of [
      ['reporter', A.page],
      ['reported', B.page],
      ['staff', S.page],
    ] as const) {
      await p.screenshot({ path: `${dir}/safety-${locale}-${n}.png` }).catch(() => undefined);
    }
    throw error;
  } finally {
    await pool.end();
    await A.context.close();
    await B.context.close();
    await S.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of ['en', 'he'] as const) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser);
    await showcase(
      `showcase-safety-${locale}`,
      [
        '25-report-filled',
        '27-verify-pose',
        '28-verify-pending',
        locale === 'he' ? '30-warning' : '30-suspended',
      ].map((n) => `${locale}/${n}`),
    );
  }
} finally {
  await browser.close();
}
reportA11y();
