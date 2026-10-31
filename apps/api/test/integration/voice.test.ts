// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processAudio, type JobContext } from '../../../worker/src/jobs.js';
import { purgeClosedChats } from '../../../worker/src/profile-jobs.js';
import { sendPush, type PushContext } from '../../../worker/src/push.js';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const BOUNDARY = 'voiceboundary';
function recording(seconds = 2, ext = 'webm', codec = 'libopus'): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'voice-it-'));
  const out = join(dir, `v.${ext}`);
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=330:duration=${seconds}`,
    '-c:a',
    codec,
    '-y',
    out,
  ]);
  return readFileSync(out);
}
const multipart = (file: Buffer, name = 'voice.webm') => ({
  payload: Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]),
  headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
});

describe.skipIf(!integrationEnabled)('voice messages & push (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;
  let worker: JobContext;

  beforeAll(async () => {
    ctx = await setupIntegration();
    worker = {
      db: ctx.services.dbHandle.db,
      storage: ctx.services.storage,
      scanner: { scan: async () => ({ clean: true }) },
      scanningEnabled: true,
      log: { warn: () => undefined, info: () => undefined } as never,
    };
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
  });

  const text = (m: Member, body: string) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
      text: body,
      clientId: `c-${Date.now()}-${(n += 1)}`,
    });
  const unlock = async () => {
    for (let i = 0; i < 3; i += 1) {
      await text(noa, `hi ${i}`);
      await text(dan, `hey ${i}`);
    }
  };
  const sendVoice = (m: Member, file: Buffer, name?: string) => {
    const body = multipart(file, name);
    return ctx.app.inject({
      method: 'POST',
      url: `/v1/matches/${matchId}/voice`,
      headers: { cookie: m.cookie, ...body.headers },
      payload: body.payload,
    });
  };
  const messages = async (m: Member) =>
    (await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`)).json();

  it('unlocks with the 3+3 rule, respects the receiver, and validates the file', async () => {
    expect((await sendVoice(noa, recording())).statusCode).toBe(403);
    await unlock();
    expect((await sendVoice(noa, Buffer.from('definitely not audio'))).statusCode).toBe(415);
    expect((await sendVoice(noa, Buffer.alloc(2 * 1024 * 1024 + 10, 1))).statusCode).toBe(413);

    // Dan turns voice messages off (e.g. hard of hearing): Noa is told, and cannot send.
    expect((await api(ctx, dan, 'PUT', '/v1/me/settings', { acceptVoice: false })).statusCode).toBe(
      200,
    );
    expect((await messages(noa)).otherAcceptsVoice).toBe(false);
    const refused = await sendVoice(noa, recording());
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toContain('does not accept voice');
    await api(ctx, dan, 'PUT', '/v1/me/settings', { acceptVoice: true });
    expect((await api(ctx, dan, 'GET', '/v1/me/settings')).json()).toEqual({
      acceptVoice: true,
      acceptCalls: true,
      allowTranscripts: true,
      readReceipts: true,
      signinAlerts: true,
      notifyMatches: true,
      notifyMessages: true,
      notifyEvents: true,
      quietHours: null,
      dailyLikeLimit: null,
      verifiedContactOnly: false,
      blurPhotos: false,
      hideDistance: false,
      discreetNotifications: false,
      openToMatchmakers: false,
      friendSuggestions: true,
      appBadge: true,
      pushDevices: 0,
    });
  });

  it('runs the real pipeline: hidden until re-encoded, then playable only by the two of them', async () => {
    await unlock();
    const sent = await sendVoice(noa, recording(2));
    expect(sent.statusCode).toBe(200);
    expect(sent.json().voice).toMatchObject({ status: 'pending', url: null });
    // The receiver does not see it before processing.
    expect((await messages(dan)).messages.some((m: { kind: string }) => m.kind === 'voice')).toBe(
      false,
    );

    const { audioId } = ctx.jobs.audio.at(-1)!;
    expect(await processAudio(worker, { audioId })).toBe('clean');
    const voice = (await messages(dan)).messages.find((m: { kind: string }) => m.kind === 'voice');
    expect(voice.voice.status).toBe('clean');
    expect(voice.voice.durationMs).toBeGreaterThan(1800);
    const play = await api(ctx, dan, 'GET', voice.voice.url);
    expect(play.statusCode).toBe(200);
    expect(play.headers['content-type']).toBe('audio/mp4');
    expect(play.rawPayload.subarray(4, 8).toString()).toBe('ftyp'); // re-encoded MP4
    const opus = await api(ctx, dan, 'GET', `${voice.voice.url}?format=opus`);
    expect(opus.statusCode).toBe(200);
    expect(opus.headers['content-type']).toBe('audio/webm');
    expect(opus.rawPayload.subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // EBML / WebM

    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await api(ctx, eve, 'GET', voice.voice.url)).statusCode).toBe(404);
    await api(ctx, noa, 'DELETE', `/v1/matches/${matchId}`);
    expect((await api(ctx, dan, 'GET', voice.voice.url)).statusCode).toBe(404);

    // 31 days after the unmatch, the clip and its file are purged with the chat.
    await ctx.services.dbHandle.pool.query(
      `UPDATE matches SET unmatched_at = now() - interval '31 days'`,
    );
    const purged = await purgeClosedChats(ctx.services.dbHandle.db, ctx.services.storage);
    expect(purged.voice).toBe(1);
    expect(
      await ctx.services.storage.listKeys(ctx.services.storage.buckets.media, 'audio/'),
    ).toEqual([]);
  });

  it('rejects recordings that cannot be decoded', async () => {
    await unlock();
    const broken = recording(2).subarray(0, 300);
    expect((await sendVoice(noa, broken)).statusCode).toBe(200);
    expect(await processAudio(worker, { audioId: ctx.jobs.audio.at(-1)!.audioId })).toBe(
      'rejected',
    );
    const mine = (await messages(noa)).messages.find((m: { kind: string }) => m.kind === 'voice');
    expect(mine.voice.status).toBe('rejected');
  });

  it('keeps reported voice notes as evidence that staff can play (audited)', async () => {
    await unlock();
    await sendVoice(dan, recording(2));
    await processAudio(worker, { audioId: ctx.jobs.audio.at(-1)!.audioId });
    const ids = (await messages(noa)).messages.map((m: { id: string }) => m.id);
    const { reportId } = (
      await api(ctx, noa, 'POST', '/v1/reports', {
        targetId: dan.id,
        category: 'harassment',
        messageIds: ids,
      })
    ).json();

    // Staff with TOTP.
    const cookie = await signIn(ctx, 'mod@example.test');
    await ctx.services.dbHandle.pool.query(
      `UPDATE "user" SET role = 'moderator' WHERE email = 'mod@example.test'`,
    );
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    ctx.clock.value += 30_000;
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });

    // The chat is purged; the evidence copy survives.
    await ctx.services.dbHandle.pool.query('DELETE FROM messages');
    await ctx.services.dbHandle.pool.query('DELETE FROM audio_clips');
    const detail = (
      await ctx.app.inject({
        method: 'GET',
        url: `/v1/admin/reports/${reportId}`,
        headers: { cookie },
      })
    ).json();
    const voice = detail.evidence.find((e: { kind: string }) => e.kind === 'voice');
    expect(voice).toMatchObject({ from: 'reported', body: null });
    expect(detail.evidence.filter((e: { kind: string }) => e.kind === 'text')).toHaveLength(6);
    const audio = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/reports/${reportId}/evidence/${voice.id}/audio`,
      headers: { cookie },
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['cache-control']).toBe('no-store');
    const opusEvidence = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/reports/${reportId}/evidence/${voice.id}/audio?format=opus`,
      headers: { cookie },
    });
    expect(opusEvidence.statusCode).toBe(200);
    expect(opusEvidence.headers['content-type']).toBe('audio/webm');
    expect(
      (await api(ctx, noa, 'GET', `/v1/admin/reports/${reportId}/evidence/${voice.id}/audio`))
        .statusCode,
    ).toBe(403);
    const log = await ctx.services.dbHandle.pool.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'staff.evidence_audio_played'`,
    );
    expect(log.rows[0].n).toBe(2); // every play is audited
  });

  describe('push notifications', () => {
    let server: Server;
    let received: { body: unknown; auth: string | undefined }[] = [];
    let reply: (count: number) => unknown = (count) => ({
      data: Array.from({ length: count }, () => ({ status: 'ok', id: 'x' })),
    });
    let url = '';
    const push = (
      job: { userId: string; kind: 'message' | 'match'; matchId: string },
      extra: Partial<PushContext> = {},
    ) =>
      sendPush(
        {
          db: ctx.services.dbHandle.db,
          redis: ctx.redis,
          log: { info: () => undefined, warn: () => undefined },
          provider: 'expo',
          expoUrl: url,
          expoAccessToken: 'test-access',
          ...extra,
        },
        job,
      );
    const token = (s: string) => `ExponentPushToken[${s.padEnd(22, 'x')}]`;

    beforeAll(async () => {
      server = createServer((req, res) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          const body = JSON.parse(data) as unknown[];
          received.push({ body, auth: req.headers.authorization });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(reply(body.length)));
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as { port: number }).port}/push`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));
    beforeEach(() => {
      received = [];
      reply = (count) => ({
        data: Array.from({ length: count }, () => ({ status: 'ok', id: 'x' })),
      });
    });

    it('registers only valid tokens and moves a device to whoever signed in last', async () => {
      expect(
        (
          await api(ctx, dan, 'POST', '/v1/me/push-tokens', {
            token: 'not-a-token',
            platform: 'ios',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await api(ctx, dan, 'POST', '/v1/me/push-tokens', {
            token: token('dan'),
            platform: 'ios',
            locale: 'he',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await api(ctx, noa, 'POST', '/v1/me/push-tokens', {
            token: token('dan'),
            platform: 'ios',
          })
        ).statusCode,
      ).toBe(200);
      const owner = await ctx.services.dbHandle.pool.query('SELECT user_id FROM push_tokens');
      expect(owner.rows).toEqual([{ user_id: noa.id }]);
      // Someone else cannot remove Noa's device.
      await api(ctx, dan, 'DELETE', '/v1/me/push-tokens', { token: token('dan') });
      expect(
        (await ctx.services.dbHandle.pool.query('SELECT count(*)::int AS n FROM push_tokens'))
          .rows[0].n,
      ).toBe(1);
    });

    it('queues a push for the receiver and sends no names or message text', async () => {
      await api(ctx, dan, 'POST', '/v1/me/push-tokens', {
        token: token('dan'),
        platform: 'android',
        locale: 'he',
      });
      await text(noa, 'Dinner at Port Said on Thursday?');
      expect(ctx.jobs.push).toContainEqual({ userId: dan.id, kind: 'message', matchId });
      expect(await push({ userId: dan.id, kind: 'message', matchId })).toBe('sent');
      const sentJson = JSON.stringify(received[0]!.body);
      expect(sentJson).not.toContain('Noa');
      expect(sentJson).not.toContain('Port Said');
      expect(received[0]!.body).toEqual([
        expect.objectContaining({
          to: token('dan'),
          title: 'NexaHeart',
          body: 'יש לך הודעה חדשה',
          data: { type: 'message', matchId },
        }),
      ]);
      expect(received[0]!.auth).toBe('Bearer test-access');
      // Throttled per conversation for two minutes.
      expect(await push({ userId: dan.id, kind: 'message', matchId })).toBe('throttled');
    });

    it('skips people who are online, conversations that ended, and removes dead tokens', async () => {
      await api(ctx, dan, 'POST', '/v1/me/push-tokens', { token: token('dan1'), platform: 'ios' });
      await api(ctx, dan, 'POST', '/v1/me/push-tokens', { token: token('dan2'), platform: 'ios' });
      await ctx.redis.set(`nexaheart:presence:${dan.id}`, '1', 'EX', 60);
      expect(await push({ userId: dan.id, kind: 'match', matchId })).toBe('online');
      await ctx.redis.del(`nexaheart:presence:${dan.id}`);

      reply = () => ({
        data: [
          { status: 'ok', id: 'a' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
        ],
      });
      expect(await push({ userId: dan.id, kind: 'match', matchId })).toBe('sent');
      const left = await ctx.services.dbHandle.pool.query(
        'SELECT token FROM push_tokens ORDER BY token',
      );
      expect(left.rows.map((r) => r.token)).toHaveLength(1);

      await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
      expect(await push({ userId: dan.id, kind: 'message', matchId })).toBe('inactive');
      expect(
        await push({ userId: dan.id, kind: 'message', matchId }, { provider: 'disabled' }),
      ).toBe('disabled');
    });

    it('creating a match queues a push for the person who was liked back', async () => {
      const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: eve.id, kind: 'like' });
      const res = (
        await api(ctx, eve, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
      ).json();
      expect(ctx.jobs.push).toContainEqual({ userId: dan.id, kind: 'match', matchId: res.matchId });
    });
  });
});
