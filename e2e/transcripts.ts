// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Voice transcripts (phase 26) end to end, with the real speech model in the worker:
 * - A records real speech (a fake microphone playing generated English speech) and sends it.
 * - B taps "Show text": the worker transcribes it on this server and the text appears.
 * - Someone who shared "deaf or hard of hearing" gets the text without asking.
 * - A speaker who chooses "voice only" is respected.
 * The UI is checked in every language; the words themselves only in English (the generated voice
 * speaks English).
 * Usage: pnpm --dir e2e transcripts (the first run downloads the model, about 77 MB)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCESSIBILITY_CONSENT_VERSION } from '@nexaheart/shared';
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { LOCALE_TAGS, locales, onboardMember, reportA11y, shot, WEB } from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
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

/** Real speech for the fake microphone: ffmpeg's built-in voice, then a pause. */
const SPOKEN = 'Hello Dan, would you like to meet for coffee on Thursday evening?';
const speech = join(mkdtempSync(join(tmpdir(), 'nexaheart-speech-')), 'speech.wav');
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  `flite=text='${SPOKEN}':voice=slt`,
  '-af',
  'apad=pad_dur=4',
  '-ar',
  '48000',
  '-ac',
  '1',
  '-y',
  speech,
]);

async function open(browser: Browser, locale: L, session: { name: string; value: string }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    permissions: ['microphone'],
  });
  await context.addCookies([
    {
      name: session.name,
      value: session.value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

async function run(browser: Browser, locale: L) {
  const t = T[locale];
  const [aName, bName] = NAMES[locale];
  const a = await onboardMember(`transcripts-${locale}`, aName, 'woman', ['man']);
  const b = await onboardMember(`transcripts-${locale}`, bName, 'man', ['woman']);
  await b.call('POST', '/v1/interactions', { targetId: a.id, kind: 'like' });
  const { matchId } = await a.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: b.id,
    kind: 'like',
  });
  const stamp = Date.now();
  for (let i = 0; i < 3; i += 1) {
    await a.call('POST', `/v1/matches/${matchId}/messages`, {
      text: `${i + 1} 🙂`,
      clientId: `ta-${stamp}-${i}`,
    });
    await b.call('POST', `/v1/matches/${matchId}/messages`, {
      text: `${i + 1} 😊`,
      clientId: `tb-${stamp}-${i}`,
    });
  }
  // In Hebrew, B shared "deaf or hard of hearing": the text comes by itself.
  const automatic = locale === 'he';
  if (automatic) {
    await b.call('PUT', '/v1/me/consents', {
      consents: [{ kind: 'accessibility', granted: true, version: ACCESSIBILITY_CONSENT_VERSION }],
    });
    await b.call('PUT', '/v1/me/access-needs', { needs: ['deaf_hoh'], show: false });
  }

  const A = await open(browser, locale, a.session);
  const B = await open(browser, locale, b.session);
  try {
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByRole('button', { name: t.voice.record }).click();
    await A.page.getByRole('button', { name: t.voice.start }).click();
    await A.page.getByRole('button', { name: t.voice.stop }).waitFor();
    await A.page.waitForTimeout(6000);
    await A.page.getByRole('button', { name: t.voice.stop }).click();
    await A.page.getByRole('button', { name: t.voice.send }).click();

    await B.page.goto(`${WEB}/chat/${matchId}`);
    const play = B.page.getByRole('button', {
      name: new RegExp(t.voice.play.split('{{')[0]!.trim().replace(/,$/, '')),
    });
    await play.first().waitFor({ timeout: 60_000 });
    if (!automatic) {
      await B.page.getByRole('button', { name: t.transcript.show }).click();
    } else {
      check(
        (await B.page.getByRole('button', { name: t.transcript.show }).count()) === 0,
        'no button needed: the text was asked for automatically',
      );
    }
    // The first transcript may wait for the model download.
    const caption = B.page.getByText(t.transcript.automatic);
    await caption.waitFor({ timeout: 240_000 });
    const conversation = (await B.page.locator('body').innerText()) ?? '';
    if (locale === 'en') {
      check(
        /coffee/i.test(conversation) && /thursday/i.test(conversation),
        'the real model wrote what was said ("coffee", "Thursday")',
      );
    } else {
      check(true, 'the text appeared under the voice message');
    }
    await shot(B.page, `${locale}/99-voice-transcript`);

    // The speaker sees it too (one transcript for both).
    await A.page.reload();
    await A.page.getByText(t.transcript.automatic).waitFor({ timeout: 30_000 });
    check(true, 'the speaker sees the same text');

    if (locale === 'en') {
      // Voice only: the text disappears for the listener.
      await a.call('PUT', '/v1/me/settings', { allowTranscripts: false });
      await B.page.reload();
      await B.page.getByText(t.transcript.voiceOnly).waitFor({ timeout: 30_000 });
      check(true, '"voice only" is respected and the text is gone');
      await A.page.goto(`${WEB}/settings`);
      await A.page.getByRole('checkbox', { name: t.transcript.allowLabel }).waitFor();
      await shot(A.page, `${locale}/100-settings-transcripts`);
      await a.call('PUT', '/v1/me/settings', { allowTranscripts: true });
    }
  } catch (error) {
    const dir = process.env.FAILURE_DIR ?? tmpdir();
    await A.page.screenshot({ path: join(dir, `transcripts-${locale}-a.png`) }).catch(() => {});
    await B.page.screenshot({ path: join(dir, `transcripts-${locale}-b.png`) }).catch(() => {});
    throw error;
  } finally {
    await A.context.close();
    await B.context.close();
  }
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${speech}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(browser, locale);
  }
} finally {
  await browser.close();
}
reportA11y();
process.stdout.write(
  problems.length ? `\n${problems.length} problem(s)\n` : '\nall checks passed\n',
);
if (problems.length) process.exitCode = 1;
