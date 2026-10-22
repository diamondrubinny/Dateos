/**
 * Video dates end to end, through a real LiveKit server: two people in two browsers with fake
 * cameras and microphones. One invites, the other joins from the incoming-call screen, both are
 * connected, a camera is turned on and seen by the other side, the call ends and leaves a line in
 * the chat. Then a declined voice call. In every language, with axe and screenshots.
 *
 * Needs the dev stack plus LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in .env).
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { RoomServiceClient } from 'livekit-server-sdk';
import { chromium, type Browser, type Page } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { demoPhoto } from './demo-images.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import {
  apiClient,
  LOCALE_TAGS,
  locales,
  magicLink,
  reportA11y,
  shot,
  showcase,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
/** LiveKit's own view of the room: whether each published track is end-to-end encrypted. */
const rooms = new RoomServiceClient(
  (process.env.LIVEKIT_API_URL ?? process.env.LIVEKIT_URL ?? '').replace(/^ws/, 'http'),
  process.env.LIVEKIT_API_KEY ?? '',
  process.env.LIVEKIT_API_SECRET ?? '',
);

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = {
  en: ['Maya', 'Ari'],
  he: ['נועה', 'אורי'],
  ar: ['ليلى', 'سامي'],
  ru: ['Анна', 'Илья'],
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''));

async function member(
  locale: L,
  name: string,
  gender: 'woman' | 'man',
  photo: 'sunset' | 'coffee' | 'mountains',
) {
  const session = await signInHttp(`calls-${locale}-${name.length}-${Date.now()}@example.test`);
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
    birthDate: '1993-03-03',
    gender,
    interestedIn: [gender === 'woman' ? 'man' : 'woman'],
    intention: 'long_term',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: 'A long walk by the sea.' }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto(photo))], { type: 'image/jpeg' }),
    'me.jpg',
  );
  await call('POST', '/v1/me/photos', form);
  for (let i = 0; i < 60; i += 1) {
    const me = await call<{ user: { id: string }; photos: { status: string }[] }>('GET', '/v1/me');
    if (me.photos[0]?.status === 'clean')
      return { cookieName: session.name, value: session.value, call, id: me.user.id, name };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('photo was not processed');
}
type Member = Awaited<ReturnType<typeof member>>;

/**
 * A stand-in for the browser's on-device speech recognition (the standard API with
 * `processLocally`), so the test doesn't download a real language pack. Plain JavaScript text:
 * a bundled function would reference build helpers that don't exist in the page. `downloadable`
 * starts without the language pack (like a real Chrome) and gets it when the app asks to install.
 */
function fakeOnDeviceSpeech(words: string, mode: 'downloadable' | 'unavailable'): string {
  return `(() => {
    let state = ${JSON.stringify(mode)};
    class FakeRecognition {
      static available(o) { return Promise.resolve(o && o.processLocally ? state : 'unavailable'); }
      static install(o) {
        if (!o || !o.processLocally || state === 'unavailable') return Promise.resolve(false);
        state = 'available';
        return Promise.resolve(true);
      }
      constructor() {
        this.processLocally = false; this.lang = ''; this.continuous = false;
        this.interimResults = false; this.onresult = null; this.onerror = null; this.onend = null;
        this.timers = [];
      }
      start() {
        if (!this.processLocally) throw new Error('cloud recognition is not allowed');
        const say = (isFinal, at) => this.timers.push(setTimeout(() => this.onresult && this.onresult({
          resultIndex: 0,
          results: [Object.assign([{ transcript: ${JSON.stringify(words)} }], { isFinal })],
        }), at));
        say(false, 400);
        say(true, 900);
      }
      abort() { this.timers.forEach(clearTimeout); }
    }
    window.SpeechRecognition = FakeRecognition;
  })();`;
}

const WORDS: Record<L, string> = {
  en: 'So nice to finally hear your voice',
  he: 'כל כך נחמד לשמוע סוף סוף את הקול שלך',
  ar: 'من الجميل أن أسمع صوتك أخيرًا',
  ru: 'Так приятно наконец услышать твой голос',
};

async function open(browser: Browser, who: Member, locale: L, speech?: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
    permissions: ['camera', 'microphone'],
  });
  await context.addCookies([
    {
      name: who.cookieName,
      value: who.value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  if (speech) await context.addInitScript({ content: speech });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  if (process.env.E2E_DEBUG)
    page.on('console', (m) =>
      process.stdout.write(`    [${who.name}] ${m.type()}: ${m.text().slice(0, 300)}\n`),
    );
  return { context, page };
}

/** Whether a <video> on the page is showing real frames from the other person. */
const videoPlaying = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('video')].some(
      (v) => v.videoWidth > 0 && v.readyState >= 2 && !v.paused,
    ),
  );

/** The dashboard (English and Hebrew): an admin turns video dates on and sets the length. */
async function adminEnables(
  browser: Browser,
  locale: 'en' | 'he',
  pool: ReturnType<typeof createDb>['pool'],
) {
  const a = adminMessages[locale];
  await pool.query('UPDATE instance_settings SET calls_enabled = false WHERE id = 1');
  const email = `calls-admin-${locale}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  await pool.query('DELETE FROM rate_limit');
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
  const page = await context.newPage();
  try {
    await page.goto(`${ADMIN}/`);
    await page.getByLabel(a.signIn.email).fill(email);
    await page.getByRole('button', { name: a.signIn.submit }).click();
    await page.getByText(a.signIn.sent).waitFor();
    await page.goto(await magicLink(email));
    await page.getByRole('button', { name: a.mfa.start }).click();
    const secret = (await page.locator('code.secret').innerText()).replace(/\s/g, '');
    await page.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
    await page.getByRole('button', { name: a.mfa.submit }).click();
    await page.getByRole('heading', { name: a.reports.title }).waitFor();
    await page.getByRole('link', { name: a.branding.nav }).click();
    await page.getByRole('heading', { name: a.branding.callsTitle }).waitFor();
    await page.getByLabel(a.branding.callsEnable).check();
    await page.getByLabel(a.branding.callsMax).fill('45');
    await page.getByRole('button', { name: a.branding.callsSave }).click();
    await page.getByText(a.branding.callsSaved).waitFor();
    const { rows } = await pool.query(
      'SELECT calls_enabled, call_max_minutes FROM instance_settings WHERE id = 1',
    );
    check(
      rows[0]?.calls_enabled === true && rows[0]?.call_max_minutes === 45,
      'an admin turned video dates on in the dashboard',
    );
    await page.getByRole('heading', { name: a.branding.callsTitle }).scrollIntoViewIfNeeded();
    await shot(page, `${locale}/admin-10-video-dates`);
  } finally {
    await context.close();
  }
}

async function run(locale: L, browser: Browser, pool: ReturnType<typeof createDb>['pool']) {
  const t = T[locale];
  const [aName, bName] = NAMES[locale];
  if (locale === 'en' || locale === 'he') await adminEnables(browser, locale, pool);
  await pool.query('DELETE FROM rate_limit');
  const a = await member(locale, aName, 'woman', 'sunset');
  const b = await member(locale, bName, 'man', 'mountains');
  await b.call('POST', '/v1/interactions', { targetId: a.id, kind: 'like' });
  const { matchId } = await a.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: b.id,
    kind: 'like',
  });
  const lines = ['Hi!', 'How was your day?', 'Up for a quick video date?'];
  for (const [i, text] of lines.entries()) {
    await a.call('POST', `/v1/matches/${matchId}/messages`, {
      text,
      clientId: `ca-${i}-${Date.now()}`,
    });
    await b.call('POST', `/v1/matches/${matchId}/messages`, {
      text: `${text} :)`,
      clientId: `cb-${i}-${Date.now()}`,
    });
  }

  const A = await open(browser, a, locale);
  // Bob's browser can make captions on the device after downloading the language pack, except in
  // the Russian run (no on-device recognition at all).
  const B = await open(
    browser,
    b,
    locale,
    fakeOnDeviceSpeech(WORDS[locale], locale === 'ru' ? 'unavailable' : 'downloadable'),
  );
  try {
    // Bob waits in the app; Alice opens the chat and invites him to a video date.
    await B.page.goto(`${WEB}/matches`);
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByRole('button', { name: fill(t.call.start, { name: bName }) }).click();
    await A.page.getByRole('button', { name: t.call.startVideo }).waitFor();
    await shot(A.page, `${locale}/51-call-choose`);
    await A.page.getByRole('button', { name: t.call.startVideo }).click();

    // First call on this device: the notice (camera off, recording, report).
    await A.page.getByRole('heading', { name: t.call.noticeTitle }).waitFor();
    await shot(A.page, `${locale}/52-call-notice`);
    await A.page.getByRole('button', { name: t.call.noticeContinue }).click();
    await A.page.getByText(fill(t.call.calling, { name: bName })).waitFor({ timeout: 15_000 });

    // Bob gets the invitation wherever he is.
    const incoming = fill(t.call.incomingVideo, { name: aName });
    await B.page.getByText(incoming).waitFor({ timeout: 15_000 });
    await shot(B.page, `${locale}/53-call-incoming`);
    await B.page.getByRole('alertdialog').getByRole('button', { name: t.call.join }).click();
    await B.page.getByRole('button', { name: t.call.noticeContinue }).click();

    await A.page
      .getByText(fill(t.call.connectedWith, { name: bName }))
      .waitFor({ timeout: 20_000 });
    await B.page
      .getByText(fill(t.call.connectedWith, { name: aName }))
      .waitFor({ timeout: 20_000 });
    check(true, 'both people are connected through LiveKit');
    // End-to-end encryption: both sides say so and show the same safety code.
    await A.page.getByText(t.call.private).waitFor({ timeout: 15_000 });
    await B.page.getByText(t.call.private).waitFor({ timeout: 15_000 });
    const code = async (page: Page) =>
      page
        .getByLabel(new RegExp(`^${t.call.safetyCode.split('{{')[0]!.trim()}`))
        .first()
        .getAttribute('aria-label');
    const [codeA, codeB] = [await code(A.page), await code(B.page)];
    check(Boolean(codeA) && codeA === codeB, `both see the same safety code (${codeA})`);
    check(!(await videoPlaying(B.page)), 'nobody is seen before turning the camera on');

    // Alice turns her camera on; Bob sees her (fake camera frames) and is told so.
    await A.page.getByRole('button', { name: t.call.cameraOn }).click();
    await B.page
      .getByText(fill(t.call.theirCameraOn, { name: aName }))
      .waitFor({ timeout: 15_000 });
    await B.page.waitForFunction(
      () => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0),
      undefined,
      { timeout: 15_000 },
    );
    check(await videoPlaying(B.page), 'the other person sees the camera that was turned on');
    await B.page.getByRole('button', { name: t.call.mute }).click();
    await B.page.getByRole('button', { name: t.call.unmute }).waitFor();
    check(true, 'mute and unmute');
    await shot(B.page, `${locale}/54-call-video`);
    await shot(A.page, `${locale}/55-call-self`);
    // The server only ever forwarded encrypted frames: LiveKit marks every track GCM-encrypted.
    const { rows: roomRows } = await pool.query('SELECT room FROM calls WHERE match_id = $1', [
      matchId,
    ]);
    const tracks = (await rooms.listParticipants(String(roomRows[0]?.room))).flatMap(
      (p) => p.tracks,
    );
    check(
      tracks.length >= 3 && tracks.every((track) => track.encryption === 1),
      `all ${tracks.length} tracks are end-to-end encrypted (GCM)`,
    );

    // Captions: Maya asks; Bob's device transcribes Bob on the device and tells him so.
    await A.page.getByRole('button', { name: t.call.captionsOn }).click();
    if (locale === 'ru') {
      await B.page.getByRole('button', { name: t.call.unmute }).click();
      await A.page
        .getByText(fill(t.call.captionsUnavailable, { name: bName }))
        .waitFor({ timeout: 15_000 });
      await B.page.getByText(fill(t.call.captionsCantSend, { name: aName })).waitFor();
      check(true, 'no on-device recognition: no captions, and both are told');
    } else {
      // Bob is still muted from the step above: a muted microphone means no captions either.
      await A.page.getByText(fill(t.call.captionsWaiting, { name: bName })).waitFor();
      await A.page.waitForTimeout(1500);
      check(
        !(await A.page.getByText(WORDS[locale]).isVisible()) &&
          !(await B.page.getByText(fill(t.call.captionsSending, { name: aName })).isVisible()),
        'nothing is transcribed while the microphone is muted',
      );
      await B.page.getByRole('button', { name: t.call.unmute }).click();
      // The language pack isn't on the device yet: Bob chooses to download it (once).
      await B.page.getByRole('button', { name: t.call.captionsInstall }).click();
      await B.page.getByText(fill(t.call.captionsSending, { name: aName })).waitFor();
      await A.page.getByText(WORDS[locale]).last().waitFor({ timeout: 15_000 });
      check(true, 'captions made on the other device arrive, inside the encrypted call');
      await shot(A.page, `${locale}/59-call-captions`);
      await A.page.getByRole('button', { name: t.call.captionsOff }).click();
      await B.page
        .getByText(fill(t.call.captionsSending, { name: aName }))
        .waitFor({ state: 'hidden' });
      check(true, 'hiding captions stops the transcription on the other device');
    }

    // Alice hangs up: the room is closed, Bob's screen shows that the call ended.
    await A.page.getByRole('button', { name: t.call.end }).click();
    await B.page.getByRole('heading', { name: t.call.ended }).waitFor({ timeout: 15_000 });
    await shot(B.page, `${locale}/56-call-ended`);
    const ended = await pool.query(`SELECT status FROM calls WHERE match_id = $1`, [matchId]);
    check(ended.rows[0]?.status === 'ended', 'the call is recorded as ended (no media stored)');

    // The chat shows the call line.
    // "Back to the chat" opens the chat even when the call was joined from another screen.
    await B.page.getByRole('button', { name: t.call.backToChat }).click();
    await B.page.waitForURL(`**/chat/${matchId}`);
    await B.page
      .getByText(fill(t.call.lineEnded, { kind: t.call.video, minutes: 1 }))
      .waitFor()
      .catch(async (e) => {
        await B.page.screenshot({ path: '/tmp/claude-0/debug-line.png' });
        process.stdout.write(`${(await B.page.locator('body').innerText()).slice(0, 1500)}\n`);
        throw e;
      });

    // A voice call that Bob declines from the chat line.
    await pool.query('DELETE FROM rate_limit');
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByRole('button', { name: fill(t.call.start, { name: bName }) }).click();
    await A.page.getByRole('button', { name: t.call.startVoice }).click();
    await A.page.getByText(fill(t.call.calling, { name: bName })).waitFor({ timeout: 15_000 });
    check(
      !(await A.page.getByRole('button', { name: t.call.cameraOn }).isVisible()),
      'a voice call has no camera button',
    );
    await B.page
      .getByText(fill(t.call.incomingVoice, { name: aName }))
      .waitFor({ timeout: 15_000 });
    await B.page.getByRole('alertdialog').getByRole('button', { name: t.call.notNow }).click();
    await A.page
      .getByRole('heading', { name: fill(t.call.lineDeclinedByThem, { kind: t.call.voice }) })
      .waitFor({ timeout: 15_000 });
    check(true, 'a declined call tells the caller, kindly');
    await shot(A.page, `${locale}/57-call-declined`);
  } finally {
    await A.context.close();
    await B.context.close();
  }
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const { pool } = createDb(process.env.DATABASE_URL ?? '');
try {
  await pool.query(
    `INSERT INTO instance_settings (id, calls_enabled) VALUES (1, true)
     ON CONFLICT (id) DO UPDATE SET calls_enabled = true`,
  );
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser, pool);
    await showcase(
      `showcase-calls-${locale}`,
      ['53-call-incoming', '54-call-video', '56-call-ended'].map((n) => `${locale}/${n}`),
    );
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length) {
  process.stdout.write(`\n${problems.length} check(s) failed\n${problems.join('\n')}\n`);
  process.exitCode = 1;
}
