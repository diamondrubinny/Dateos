// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { RELIGION_CONSENT_VERSION } from '@nexaheart/shared';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processAudio, type JobContext } from '../../../worker/src/jobs.js';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

const BOUNDARY = 'aboutboundary';
function tone(seconds: number): Buffer {
  const out = join(mkdtempSync(join(tmpdir(), 'about-it-')), 'v.webm');
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=330:duration=${seconds}`,
    '-c:a',
    'libopus',
    '-y',
    out,
  ]);
  return readFileSync(out);
}
const multipart = (file: Buffer) => ({
  payload: Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="v.webm"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]),
  headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
});

describe.skipIf(!integrationEnabled)('about me and dealbreakers (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const woman = (name = 'Noa') =>
    createMember(ctx, { name, gender: 'woman', interestedIn: ['man'] });
  const man = (name = 'Dan') => createMember(ctx, { name, gender: 'man', interestedIn: ['woman'] });
  const empty = {
    interests: [],
    children: null,
    smoking: null,
    drinking: null,
    heightCm: null,
    religion: null,
    openingQuestion: null,
  };
  const anyone = {
    smokingOk: [],
    childrenOk: [],
    religionOk: [],
    heightMin: null,
    heightMax: null,
  };
  const setAbout = (m: Member, about: object) =>
    api(ctx, m, 'PUT', '/v1/me/about', { ...empty, ...about });
  const setDeal = (m: Member, d: object) =>
    api(ctx, m, 'PUT', '/v1/me/dealbreakers', { ...anyone, ...d });
  const religionConsent = (m: Member, granted: boolean) =>
    api(ctx, m, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'religion', granted, version: RELIGION_CONSENT_VERSION }],
    });

  it('saves about-me, shows it on the profile, and ranks shared interests with a reason', async () => {
    const noa = await woman();
    const dan = await man();
    const res = await setAbout(noa, {
      interests: ['hiking', 'board_games', 'coffee'],
      children: 'want',
      smoking: 'no',
      drinking: 'socially',
      heightCm: 168,
      openingQuestion: 'What is your favourite hike?',
    });
    expect(res.statusCode).toBe(200);
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.about).toMatchObject({
      interests: ['hiking', 'board_games', 'coffee'],
      heightCm: 168,
    });

    await setAbout(dan, { interests: ['hiking', 'coffee', 'cinema'] });
    const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();
    expect(seen.about).toMatchObject({
      interests: ['hiking', 'board_games', 'coffee'],
      smoking: 'no',
      openingQuestion: 'What is your favourite hike?',
    });
    expect(seen.reasons).toContain('shared_interests');
    // Someone who never filled it in shows null.
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${dan.id}`)).json().about.children).toBeNull();
  });

  it('validates against the fixed lists and filters the opening question', async () => {
    const noa = await woman();
    expect((await setAbout(noa, { interests: ['skydiving'] })).statusCode).toBe(400);
    expect((await setAbout(noa, { heightCm: 300 })).statusCode).toBe(400);
    expect((await setAbout(noa, { interests: ['hiking', 'hiking'] })).statusCode).toBe(400);
    const eleven = [
      'hiking',
      'running',
      'gym',
      'yoga',
      'cycling',
      'swimming',
      'football',
      'basketball',
      'dancing',
      'cooking',
      'baking',
    ];
    expect((await setAbout(noa, { interests: eleven })).statusCode).toBe(400);
    expect((await setAbout(noa, { openingQuestion: 'you are a stupid idiot' })).statusCode).toBe(
      400,
    );
    expect((await setDeal(noa, { heightMin: 180, heightMax: 160 })).statusCode).toBe(400);
  });

  it('applies dealbreakers both ways, and a missing answer always passes', async () => {
    const noa = await woman();
    const smoker = await man('Smoker');
    const quiet = await man('Quiet'); // never answered
    const tall = await man('Tall');
    await setAbout(smoker, { smoking: 'yes', heightCm: 175 });
    await setAbout(tall, { smoking: 'no', heightCm: 195 });

    await setDeal(noa, { smokingOk: ['no'], heightMax: 190 });
    const seen = await discoverIds(ctx, noa);
    expect(seen).toContain(quiet.id);
    expect(seen).not.toContain(smoker.id);
    expect(seen).not.toContain(tall.id);
    // Both ways: the smoker doesn't see her either, nor can open her profile.
    expect(await discoverIds(ctx, smoker)).not.toContain(noa.id);
    expect((await api(ctx, smoker, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);

    // His dealbreaker applies to her answers.
    await setAbout(noa, { children: 'dont_want' });
    await setDeal(quiet, { childrenOk: ['want', 'open'] });
    expect(await discoverIds(ctx, noa)).not.toContain(quiet.id);
    await setDeal(noa, anyone);
    expect(await discoverIds(ctx, noa)).toEqual(expect.arrayContaining([smoker.id, tall.id]));
  });

  it('keeps religious observance behind its own consent and deletes it on withdrawal', async () => {
    const noa = await woman();
    const dan = await man();
    expect((await setAbout(noa, { religion: 'traditional' })).statusCode).toBe(403);
    expect((await setDeal(noa, { religionOk: ['traditional'] })).statusCode).toBe(403);

    await religionConsent(noa, true);
    await religionConsent(dan, true);
    expect((await setAbout(noa, { religion: 'traditional' })).statusCode).toBe(200);
    await setAbout(dan, { religion: 'not_religious' });
    expect((await setDeal(noa, { religionOk: ['traditional', 'religious'] })).statusCode).toBe(200);
    expect(await discoverIds(ctx, noa)).not.toContain(dan.id);

    // Withdrawing deletes her answer and her filter.
    await religionConsent(noa, false);
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.about.religion).toBeNull();
    expect(me.dealbreakers.religionOk).toEqual([]);
    expect(await discoverIds(ctx, noa)).toContain(dan.id);
  });

  it('voice prompt: up to 30 s, played only to people who can see the profile, replaced and deleted', async () => {
    const worker: JobContext = {
      db: ctx.services.dbHandle.db,
      storage: ctx.services.storage,
      scanner: { scan: async () => ({ clean: true }) },
      scanningEnabled: true,
      log: { warn: () => undefined, info: () => undefined } as never,
    };
    const noa = await woman();
    const dan = await man();
    const stranger = await createMember(ctx, {
      name: 'Far',
      gender: 'man',
      interestedIn: ['woman'],
      at: { lat: 29.55, lng: 34.95 }, // Eilat: too far to see her
    });
    const upload = (m: Member, file: Buffer, promptKey = 'green_flag') =>
      ctx.app.inject({
        method: 'POST',
        url: `/v1/me/voice-prompt?promptKey=${promptKey}`,
        headers: { cookie: m.cookie, ...multipart(file).headers },
        payload: multipart(file).payload,
      });
    const first = await upload(noa, tone(40));
    expect(first.statusCode).toBe(200);
    const audioId = first.json().id;
    expect(ctx.jobs.audio.at(-1)).toEqual({ audioId, maxSeconds: 30 });
    // Not shown to anyone until it's clean.
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().voicePrompt).toMatchObject({
      audioId,
      status: 'quarantine',
    });
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().voicePrompt).toBeNull();

    expect(await processAudio(worker, ctx.jobs.audio.at(-1)!)).toBe('clean');
    const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().voicePrompt;
    expect(seen).toMatchObject({ promptKey: 'green_flag', audioId });
    expect(seen.durationMs).toBeLessThanOrEqual(30_000);
    expect(seen.durationMs).toBeGreaterThan(29_000);
    expect((await api(ctx, dan, 'GET', `/v1/audio/${audioId}`)).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', `/v1/audio/${audioId}`)).statusCode).toBe(200);
    // Someone who can't see her profile can't hear it either.
    expect((await api(ctx, stranger, 'GET', `/v1/audio/${audioId}`)).statusCode).toBe(404);
    expect(
      (await api(ctx, noa, 'POST', '/v1/me/voice-prompt?promptKey=not_a_prompt')).statusCode,
    ).toBe(400);

    // A new recording replaces the old one, whose files are deleted.
    const second = (await upload(noa, tone(3), 'perfect_sunday')).json().id;
    const gone = await ctx.services.dbHandle.pool.query('SELECT 1 FROM audio_clips WHERE id = $1', [
      audioId,
    ]);
    expect(gone.rowCount).toBe(0);
    expect(ctx.jobs.delete.at(-1)!.mediaKeys.length).toBe(2);
    expect((await api(ctx, noa, 'DELETE', '/v1/me/voice-prompt')).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().voicePrompt).toBeNull();
    const left = await ctx.services.dbHandle.pool.query('SELECT 1 FROM audio_clips WHERE id = $1', [
      second,
    ]);
    expect(left.rowCount).toBe(0);
  });

  it('needs preferences before dealbreakers', async () => {
    const noa = await woman();
    await ctx.services.dbHandle.pool.query('DELETE FROM preferences WHERE user_id = $1', [noa.id]);
    expect((await setDeal(noa, { smokingOk: ['no'] })).statusCode).toBe(409);
  });
});
