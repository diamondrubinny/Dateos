import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

const BOUNDARY = 'chatboundary';
async function imageBody() {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#7c3aed' } })
    .png()
    .toBuffer();
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, png, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    type: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

describe.skipIf(!integrationEnabled)('chat (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;
  const clientId = () => `client-${Date.now()}-${(n += 1)}`;

  beforeAll(async () => {
    ctx = await setupIntegration();
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

  const send = (m: Member, text: string, id = clientId()) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, { text, clientId: id });
  const list = async (m: Member, query = '') =>
    (await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages${query}`)).json();

  it('lets only the two participants read or write', async () => {
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await send(noa, 'Hi Dan!')).statusCode).toBe(200);
    expect((await api(ctx, eve, 'GET', `/v1/matches/${matchId}/messages`)).statusCode).toBe(404);
    expect((await send(eve, 'sneaky')).statusCode).toBe(404);
    expect((await api(ctx, eve, 'POST', `/v1/matches/${matchId}/read`)).statusCode).toBe(404);
    expect((await api(ctx, eve, 'GET', `/v1/matches/${matchId}/icebreakers`)).statusCode).toBe(404);
    expect((await list(dan)).messages.map((m: { body: string }) => m.body)).toEqual(['Hi Dan!']);
  });

  it('is idempotent per clientId and paginates oldest-to-newest pages', async () => {
    const id = clientId();
    const first = (await send(noa, 'only once', id)).json();
    const retry = (await send(noa, 'only once', id)).json();
    expect(retry.id).toBe(first.id);
    for (let i = 0; i < 4; i += 1) await send(i % 2 ? noa : dan, `m${i}`);
    const page1 = await list(noa, '?limit=3');
    expect(page1.messages.map((m: { body: string }) => m.body)).toEqual(['m1', 'm2', 'm3']);
    const page2 = await list(noa, `?limit=3&before=${encodeURIComponent(page1.before)}`);
    expect(page2.messages.map((m: { body: string }) => m.body)).toEqual(['only once', 'm0']);
    expect(page2.before).toBeNull();
  });

  it('hides harmful messages for the receiver and warns about scams', async () => {
    const harmful = (await send(dan, 'send nudes')).json();
    expect(harmful).toMatchObject({ mine: true, hidden: false, harm: ['sexual'] });
    const scam = (await send(dan, 'can you send me money for my ticket?')).json();
    expect(scam.scam).toEqual([]); // the sender is not shown the warning
    const received = (await list(noa)).messages;
    expect(received[0]).toMatchObject({ mine: false, hidden: true, harm: ['sexual'] });
    expect(received[1]).toMatchObject({ hidden: false, scam: ['money'] });
  });

  it('offers an "Are you sure?" check that stores nothing', async () => {
    const res = await api(ctx, noa, 'POST', '/v1/messages/check', { text: 'you are an idiot' });
    expect(res.json()).toEqual({ flagged: true, categories: ['insult'] });
    expect((await list(noa)).messages).toHaveLength(0);
  });

  it('unlocks images only after 3 messages each, and hides them until scanned', async () => {
    const upload = async (m: Member) => {
      const body = await imageBody();
      return ctx.app.inject({
        method: 'POST',
        url: `/v1/matches/${matchId}/images`,
        headers: { cookie: m.cookie, 'content-type': body.type },
        payload: body.payload,
      });
    };
    expect((await upload(noa)).statusCode).toBe(403);
    for (let i = 0; i < 3; i += 1) {
      await send(noa, `hi ${i}`);
      await send(dan, `hey ${i}`);
    }
    expect((await list(noa)).imagesUnlocked).toBe(true);
    const sent = await upload(noa);
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ kind: 'image', image: { status: 'pending', url: null } });
    expect(ctx.jobs.process).toHaveLength(1);
    // Receiver sees nothing until the scan passes.
    expect(
      (await list(dan)).messages.filter((m: { kind: string }) => m.kind === 'image'),
    ).toHaveLength(0);

    const photoId = ctx.jobs.process[0]!.photoId;
    await ctx.services.dbHandle.pool.query(
      `UPDATE photos SET status = 'clean', media_key = 'k' WHERE id = $1`,
      [photoId],
    );
    const image = (await list(dan)).messages.find((m: { kind: string }) => m.kind === 'image');
    expect(image.image).toEqual({ status: 'clean', url: `/v1/photos/${photoId}` });
    // Chat images never show up as profile photos.
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.photos.map((p: { id: string }) => p.id)).not.toContain(photoId);
  });

  it('only participants may load a chat image', async () => {
    for (let i = 0; i < 3; i += 1) {
      await send(noa, `hi ${i}`);
      await send(dan, `hey ${i}`);
    }
    const body = await imageBody();
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/matches/${matchId}/images`,
      headers: { cookie: noa.cookie, 'content-type': body.type },
      payload: body.payload,
    });
    const photoId = ctx.jobs.process[0]!.photoId;
    const key = `photos/${noa.id}/${photoId}.webp`;
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .webp()
      .toBuffer();
    await ctx.services.storage.put(ctx.services.storage.buckets.media, key, webp, 'image/webp');
    await ctx.services.dbHandle.pool.query(
      `UPDATE photos SET status = 'clean', media_key = $2 WHERE id = $1`,
      [photoId, key],
    );
    const eve = await createMember(ctx, { name: 'Eve', gender: 'man', interestedIn: ['woman'] }); // can see Noa's profile…
    expect((await api(ctx, dan, 'GET', `/v1/photos/${photoId}`)).statusCode).toBe(200);
    expect((await api(ctx, eve, 'GET', `/v1/photos/${photoId}`)).statusCode).toBe(404); // …but not her chat images
  });

  it('tracks read receipts and unread counts in the inbox', async () => {
    await send(noa, 'one');
    await send(noa, 'two');
    let inbox = (await api(ctx, dan, 'GET', '/v1/conversations')).json().conversations;
    expect(inbox[0]).toMatchObject({
      matchId,
      unread: 2,
      lastMessage: { body: 'two', mine: false },
    });
    await api(ctx, dan, 'POST', `/v1/matches/${matchId}/read`);
    inbox = (await api(ctx, dan, 'GET', '/v1/conversations')).json().conversations;
    expect(inbox[0].unread).toBe(0);
    expect((await list(noa)).otherReadAt).not.toBeNull();
  });

  it('closes the chat for both people on unmatch and on block', async () => {
    await send(noa, 'hello');
    await api(ctx, dan, 'DELETE', `/v1/matches/${matchId}`);
    expect((await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).statusCode).toBe(404);
    expect((await send(dan, 'still there?')).statusCode).toBe(404);
    expect((await api(ctx, noa, 'GET', '/v1/conversations')).json().conversations).toHaveLength(0);
  });

  it('suggests icebreakers based on the other person’s prompts', async () => {
    const res = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/icebreakers?locale=en`)).json();
    expect(res.suggestions).toHaveLength(3);
    expect(res.suggestions[0]).toContain('Dan likes kindness');
  });

  it('deletes messages when an account is deleted', async () => {
    await send(noa, 'hello');
    await send(dan, 'hi');
    await api(ctx, noa, 'DELETE', '/v1/me');
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT count(*)::int AS n FROM messages',
    );
    expect(rows[0].n).toBe(0);
  });

  describe('websocket', () => {
    type WS = Awaited<ReturnType<TestContext['app']['injectWS']>>;
    const nextEvent = (ws: WS, type: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${type} event`)), 3_000);
        ws.on('message', (data: Buffer) => {
          const event = JSON.parse(data.toString());
          if (event.type === type) {
            clearTimeout(timer);
            resolve(event);
          }
        });
      });

    it('delivers new messages, typing and read receipts in real time', async () => {
      const ws = await ctx.app.injectWS('/v1/ws', {
        headers: { cookie: dan.cookie, origin: 'http://localhost:8081' },
      });
      await new Promise((r) => setTimeout(r, 100)); // subscription settles
      const incoming = nextEvent(ws, 'message.new');
      await send(noa, 'live hello');
      expect(await incoming).toMatchObject({
        matchId,
        message: { body: 'live hello', mine: false },
      });

      const noaWs = await ctx.app.injectWS('/v1/ws', { headers: { cookie: noa.cookie } });
      await new Promise((r) => setTimeout(r, 100));
      const typing = nextEvent(noaWs, 'typing');
      ws.send(JSON.stringify({ type: 'typing', matchId }));
      expect(await typing).toEqual({ type: 'typing', matchId });
      const read = nextEvent(noaWs, 'message.read');
      await api(ctx, dan, 'POST', `/v1/matches/${matchId}/read`);
      expect(await read).toMatchObject({ type: 'message.read', matchId });

      const closed = nextEvent(noaWs, 'match.closed');
      await api(ctx, dan, 'POST', '/v1/blocks', { userId: noa.id });
      expect(await closed).toEqual({ type: 'match.closed', matchId });
      ws.terminate();
      noaWs.terminate();
    });

    it('ignores typing events for chats the user is not in', async () => {
      const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
      const eveWs = await ctx.app.injectWS('/v1/ws', { headers: { cookie: eve.cookie } });
      const noaWs = await ctx.app.injectWS('/v1/ws', { headers: { cookie: noa.cookie } });
      await new Promise((r) => setTimeout(r, 100));
      const typing = nextEvent(noaWs, 'typing');
      eveWs.send(JSON.stringify({ type: 'typing', matchId }));
      await expect(typing).rejects.toThrow('no typing event');
      eveWs.terminate();
      noaWs.terminate();
    });

    it('rejects connections without a session or from foreign origins', async () => {
      await expect(ctx.app.injectWS('/v1/ws')).rejects.toThrow('Unexpected server response: 401');
      await expect(
        ctx.app.injectWS('/v1/ws', {
          headers: { cookie: dan.cookie, origin: 'https://evil.example' },
        }),
      ).rejects.toThrow('Unexpected server response: 403');
    });
  });
});
