// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TranscriptLang } from '@nexaheart/shared';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processAudio, type JobContext } from '../../../worker/src/jobs.js';
import { processTranscript } from '../../../worker/src/transcript-jobs.js';
import { decodeForSpeech, type Transcriber } from '../../../worker/src/transcribe.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

const BOUNDARY = 'transcriptboundary';
function recording(seconds = 2): Buffer {
  const out = join(mkdtempSync(join(tmpdir(), 'transcript-it-')), 'v.webm');
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

/** Stands in for the speech model: records what it was asked, answers with a fixed text. */
function fakeModel(answer: string) {
  const calls: { bytes: number; lang: TranscriptLang }[] = [];
  const transcriber: Transcriber = {
    transcribe: async (audio, lang) => {
      calls.push({ bytes: audio.length, lang });
      return answer;
    },
  };
  return { calls, transcriber };
}

describe.skipIf(!integrationEnabled)('voice transcripts (integration)', () => {
  let ctx: TestContext;
  let worker: JobContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;
  const published: string[] = [];

  beforeAll(async () => {
    ctx = await setupIntegration();
    worker = {
      db: ctx.services.dbHandle.db,
      storage: ctx.services.storage,
      scanner: { scan: async () => ({ clean: true }) },
      scanningEnabled: true,
      log: { warn: () => undefined, info: () => undefined } as never,
      publish: async (userId) => void published.push(userId),
    };
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    published.length = 0;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
    for (let i = 0; i < 3; i += 1) {
      for (const m of [noa, dan]) {
        await api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
          text: `hi ${i}`,
          clientId: `client-${(n += 1)}-${Date.now()}`,
        });
      }
    }
  });

  /** Noa sends a voice message recorded in Hebrew; the worker scans and re-encodes it. */
  const voiceFromNoa = async (lang = 'he') => {
    const body = multipart(recording());
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/matches/${matchId}/voice?lang=${lang}`,
      headers: { cookie: noa.cookie, ...body.headers },
      payload: body.payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { audioId } = ctx.jobs.audio.at(-1)!;
    expect(await processAudio(worker, { audioId })).toBe('clean');
    return audioId;
  };
  const ask = (m: Member, id: string) => api(ctx, m, 'POST', `/v1/audio/${id}/transcript`);
  const state = async (m: Member, id: string) =>
    (await api(ctx, m, 'GET', `/v1/audio/${id}/transcript`)).json();

  it('is made only when asked, once, in the language it was recorded in', async () => {
    const id = await voiceFromNoa();
    expect(await state(dan, id)).toEqual({ status: 'none', text: null });
    expect(ctx.jobs.transcripts).toEqual([]);

    expect((await ask(dan, id)).json()).toEqual({ status: 'pending', text: null });
    // Asking again (or the other person asking) queues nothing more.
    await ask(dan, id);
    await ask(noa, id);
    expect(ctx.jobs.transcripts).toEqual([id]);

    published.length = 0; // events from the upload itself
    const model = fakeModel('  Shalom,   see you on Thursday ');
    expect(await processTranscript(worker, model.transcriber, { audioId: id })).toBe('done');
    expect(model.calls).toEqual([{ bytes: expect.any(Number), lang: 'he' }]);
    expect(model.calls[0]!.bytes).toBeGreaterThan(1000);
    expect(await state(dan, id)).toEqual({ status: 'done', text: 'Shalom, see you on Thursday' });
    expect(await state(noa, id)).toEqual({ status: 'done', text: 'Shalom, see you on Thursday' });
    // Both people's chats are told the message changed.
    expect(published.sort()).toEqual([dan.id, noa.id].sort());
    // A second run does nothing.
    expect(await processTranscript(worker, model.transcriber, { audioId: id })).toBe('skipped');
  });

  it('is only for the two people of the chat', async () => {
    const id = await voiceFromNoa();
    const maya = await createMember(ctx, { name: 'Maya', gender: 'woman', interestedIn: ['man'] });
    expect((await ask(maya, id)).statusCode).toBe(404);
    expect((await api(ctx, maya, 'GET', `/v1/audio/${id}/transcript`)).statusCode).toBe(404);
    // A block ends access for both.
    await ask(dan, id);
    await processTranscript(worker, fakeModel('hello').transcriber, { audioId: id });
    expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id })).statusCode).toBe(200);
    expect((await api(ctx, dan, 'GET', `/v1/audio/${id}/transcript`)).statusCode).toBe(404);
    expect(ctx.jobs.transcripts).toEqual([id]);
  });

  it('respects the speaker choosing voice only, and deletes texts already made', async () => {
    const id = await voiceFromNoa();
    await ask(dan, id);
    await processTranscript(worker, fakeModel('hello').transcriber, { audioId: id });
    expect((await state(dan, id)).status).toBe('done');

    const off = await api(ctx, noa, 'PUT', '/v1/me/settings', { allowTranscripts: false });
    expect(off.statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().allowTranscripts).toBe(false);
    expect(await state(dan, id)).toEqual({ status: 'unavailable', text: null });
    expect((await ask(dan, id)).json().status).toBe('unavailable');
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT transcript, transcript_status FROM audio_clips WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ transcript: null, transcript_status: null });

    // A request already queued before the change is dropped by the worker, either way.
    await api(ctx, noa, 'PUT', '/v1/me/settings', { allowTranscripts: true });
    const second = await voiceFromNoa();
    await ask(dan, second);
    await api(ctx, noa, 'PUT', '/v1/me/settings', { allowTranscripts: false });
    expect(await processTranscript(worker, fakeModel('x').transcriber, { audioId: second })).toBe(
      'skipped',
    );
    // ...including when only the setting changed (the clip still marked as asked for).
    await ctx.services.dbHandle.pool.query(
      `UPDATE audio_clips SET transcript_status = 'pending' WHERE id = $1`,
      [second],
    );
    expect(await processTranscript(worker, fakeModel('x').transcriber, { audioId: second })).toBe(
      'not allowed',
    );
  });

  it('can be asked again after the model found nothing', async () => {
    const id = await voiceFromNoa('en');
    await ask(dan, id);
    expect(await processTranscript(worker, fakeModel('   ').transcriber, { audioId: id })).toBe(
      'empty',
    );
    expect(await state(dan, id)).toEqual({ status: 'failed', text: null });
    await ask(dan, id);
    expect(ctx.jobs.transcripts).toEqual([id, id]);
    const model = fakeModel('hello again');
    expect(await processTranscript(worker, model.transcriber, { audioId: id })).toBe('done');
    expect(model.calls[0]!.lang).toBe('en');
  });

  it('falls back to the community language, validates the language, and exports the text', async () => {
    const body = multipart(recording());
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/v1/matches/${matchId}/voice?lang=xx`,
      headers: { cookie: noa.cookie, ...body.headers },
      payload: body.payload,
    });
    expect(bad.statusCode).toBe(400);

    const plain = await ctx.app.inject({
      method: 'POST',
      url: `/v1/matches/${matchId}/voice`,
      headers: { cookie: noa.cookie, ...body.headers },
      payload: body.payload,
    });
    expect(plain.statusCode).toBe(200);
    const id = ctx.jobs.audio.at(-1)!.audioId;
    await processAudio(worker, { audioId: id });
    await ask(dan, id);
    const model = fakeModel('no language given');
    await processTranscript(worker, model.transcriber, { audioId: id });
    expect(model.calls[0]!.lang).toBe('en');

    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    expect(data.voiceMessages[0]).toMatchObject({ id, transcript: 'no language given' });
    expect(data.preferences.allowTranscripts).toBe(true);
  });

  it('decodes our own rendition to 16 kHz mono for the model', async () => {
    const id = await voiceFromNoa();
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT media_key FROM audio_clips WHERE id = $1',
      [id],
    );
    const aac = await ctx.services.storage.getBuffer(
      ctx.services.storage.buckets.media,
      rows[0].media_key,
    );
    const samples = await decodeForSpeech(aac);
    // A 2-second clip: about 32,000 samples (AAC adds a little padding).
    expect(samples.length).toBeGreaterThan(30_000);
    expect(samples.length).toBeLessThan(36_000);
    expect(Math.max(...samples.slice(8000, 9000).map(Math.abs))).toBeGreaterThan(0.05);
  });
});

describe.skipIf(!integrationEnabled)('voice transcripts turned off (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration({ transcripts: false });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  it('tells the apps, and never queues anything', async () => {
    const instance = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(instance.transcripts).toBe(false);
  });
});
