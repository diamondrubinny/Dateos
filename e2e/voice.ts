/**
 * Voice messages end to end in two browsers: record with a (fake) microphone, send, the worker
 * scans and re-encodes it, the other person plays it. Also checks the receiver's opt-out.
 */
import { chromium, type Browser } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { demoPhoto } from './demo-images.ts';
import { apiClient, reportA11y, shot, showcase, signInHttp, WEB } from './lib.ts';

const LEGAL = { terms: '2026-10', privacy: '2026-10' };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function account(email: string, name: string, gender: 'woman' | 'man') {
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  await call('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: LEGAL.terms },
      { kind: 'privacy', granted: true, version: LEGAL.privacy },
      { kind: 'sensitive', granted: true, version: '1' },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  await call('POST', '/v1/me/profile', {
    displayName: name,
    birthDate: '1993-06-06',
    gender,
    interestedIn: [gender === 'woman' ? 'man' : 'woman'],
    intention: 'long_term',
    bio: 'Music, sea and long talks.',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/location', { lat: 32.0809, lng: 34.7806 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'green_flag', answer: 'Kindness' }],
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
  throw new Error('photo not processed');
}

async function open(browser: Browser, cookie: { name: string; value: string }, locale: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale,
    permissions: ['microphone'],
  });
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
  await context.addInitScript(
    (l) => localStorage.setItem('nexaheart.locale', l),
    locale.slice(0, 2),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => process.stderr.write(`pageerror: ${e.message}\n`));
  return { context, page };
}

async function run(locale: 'en' | 'he', browser: Browser) {
  const t = locale === 'he' ? he : en;
  const stamp = Date.now();
  const a = await account(
    `voice-a-${locale}-${stamp}@example.test`,
    locale === 'he' ? 'מאיה' : 'Maya',
    'woman',
  );
  const b = await account(
    `voice-b-${locale}-${stamp}@example.test`,
    locale === 'he' ? 'יונתן' : 'Jonah',
    'man',
  );
  await b.call('POST', '/v1/interactions', { targetId: a.id, kind: 'like' });
  const { matchId } = await a.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: b.id,
    kind: 'like',
  });
  for (let i = 0; i < 3; i += 1) {
    await a.call('POST', `/v1/matches/${matchId}/messages`, {
      text: `${i + 1} 🙂`,
      clientId: `va-${stamp}-${i}`,
    });
    await b.call('POST', `/v1/matches/${matchId}/messages`, {
      text: `${i + 1} 😊`,
      clientId: `vb-${stamp}-${i}`,
    });
  }
  const L = locale === 'he' ? 'he-IL' : 'en-US';
  const A = await open(browser, a.session, L);
  const B = await open(browser, b.session, L);
  try {
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByRole('button', { name: t.voice.record }).click();
    await A.page.getByRole('button', { name: t.voice.start }).click();
    await A.page.getByRole('button', { name: t.voice.stop }).waitFor();
    await A.page.waitForTimeout(2500);
    await shot(A.page, `${locale}/31-voice-recording`);
    await A.page.getByRole('button', { name: t.voice.stop }).click();
    await A.page.getByRole('button', { name: t.voice.send }).waitFor();
    await shot(A.page, `${locale}/32-voice-ready`);
    await A.page.getByRole('button', { name: t.voice.send }).click();
    await A.page.getByText(t.voice.processing).waitFor();

    // The receiver gets it live once the worker has scanned and re-encoded it.
    await B.page.goto(`${WEB}/chat/${matchId}`);
    const play = B.page.getByRole('button', {
      name: new RegExp(t.voice.play.split('{{')[0]!.trim().replace(/,$/, '')),
    });
    await play.first().waitFor({ timeout: 60_000 });
    await play.first().click();
    await B.page.getByRole('button', { name: t.voice.pause }).waitFor();
    await shot(B.page, `${locale}/33-voice-playing`);

    // Opt-out: the receiver turns voice off, the sender is told and cannot record.
    await B.page.goto(`${WEB}/settings`);
    await B.page.getByText(t.voice.acceptLabel).waitFor();
    await shot(B.page, `${locale}/34-settings-notifications`);
    await B.page.getByRole('checkbox', { name: new RegExp(t.voice.acceptLabel) }).click();
    await new Promise((r) => setTimeout(r, 800));
    const settings = await b.call<{ acceptVoice: boolean }>('GET', '/v1/me/settings');
    assert(settings.acceptVoice === false, 'receiver turned voice off');
    await A.page.reload();
    await A.page.getByRole('button', { name: t.voice.record }).click();
    await A.page
      .getByText(t.voice.notAccepted.replace('{{name}}', locale === 'he' ? 'יונתן' : 'Jonah'))
      .waitFor();
  } catch (error) {
    const dir = process.env.FAILURE_DIR ?? '/tmp';
    await A.page.screenshot({ path: `${dir}/voice-${locale}-a.png` }).catch(() => undefined);
    await B.page.screenshot({ path: `${dir}/voice-${locale}-b.png` }).catch(() => undefined);
    throw error;
  } finally {
    await A.context.close();
    await B.context.close();
  }
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  // A synthetic microphone (a tone), so recording runs without hardware.
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
try {
  for (const locale of ['en', 'he'] as const) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser);
    await showcase(
      `showcase-voice-${locale}`,
      ['31-voice-recording', '32-voice-ready', '33-voice-playing', '34-settings-notifications'].map(
        (n) => `${locale}/${n}`,
      ),
    );
  }
} finally {
  await browser.close();
}
reportA11y();
