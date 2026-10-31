// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('a chaperone, phase 68d (integration)', () => {
  let ctx: TestContext;
  let amira: Member; // the member
  let yusuf: Member; // her match
  let fatima: Member; // the chaperone
  let omar: Member; // someone else
  let matchId: string;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));

  const say = (m: Member, body: string) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
      clientId: `msg-${Math.random().toString(36).slice(2)}-xxxx`,
      text: body,
    });
  const invite = async () =>
    (await api(ctx, amira, 'POST', '/v1/me/chaperone/link')).json().token as string;
  const page = async (m: Member) =>
    (await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`)).json();
  const transcript = (m: Member = fatima) =>
    api(ctx, m, 'GET', `/v1/chaperoning/${amira.id}/${matchId}`);

  beforeEach(async () => {
    await resetState(ctx);
    amira = await createMember(ctx, { name: 'Amira', gender: 'woman', interestedIn: ['man'] });
    yusuf = await createMember(ctx, { name: 'Yusuf', gender: 'man', interestedIn: ['woman'] });
    fatima = await createMember(ctx, { name: 'Fatima', gender: 'woman', interestedIn: ['man'] });
    omar = await createMember(ctx, { name: 'Omar', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, yusuf, 'POST', '/v1/interactions', { targetId: amira.id, kind: 'like' });
    matchId = (
      await api(ctx, amira, 'POST', '/v1/interactions', { targetId: yusuf.id, kind: 'like' })
    ).json().matchId;
    await say(yusuf, 'Before the chaperone');
  });

  it('a one-time link; the chaperone reads only what came after, text only', async () => {
    const token = await invite();
    expect((await api(ctx, fatima, 'GET', `/v1/chaperone/links/${token}`)).json()).toEqual({
      memberName: 'Amira',
    });
    expect((await api(ctx, amira, 'POST', '/v1/chaperone/join', { token })).statusCode).toBe(404); // not for oneself
    expect((await api(ctx, fatima, 'POST', '/v1/chaperone/join', { token })).statusCode).toBe(200);
    expect((await api(ctx, omar, 'POST', '/v1/chaperone/join', { token })).statusCode).toBe(404);
    ctx.clock.value += 1000;
    await q(`UPDATE messages SET created_at = now() - interval '1 minute'`);
    await say(yusuf, 'After the chaperone');
    await say(amira, 'Hello back');

    const list = (await api(ctx, fatima, 'GET', '/v1/chaperoning')).json();
    expect(list.members).toEqual([
      expect.objectContaining({
        userId: amira.id,
        displayName: 'Amira',
        chats: [{ matchId, otherName: 'Yusuf' }],
      }),
    ]);
    const res = await transcript();
    expect(res.statusCode).toBe(200);
    const t = res.json();
    expect(t).toMatchObject({ memberName: 'Amira', otherName: 'Yusuf' });
    expect(
      t.messages.map((m: { text: string; fromMember: boolean }) => [m.text, m.fromMember]),
    ).toEqual([
      ['After the chaperone', false],
      ['Hello back', true],
    ]);
    // Read-only: there's no way to write as the chaperone (not a participant).
    expect(
      (
        await api(ctx, fatima, 'POST', `/v1/matches/${matchId}/messages`, {
          clientId: 'msg-chaperone-xxxx',
          text: 'hi',
        })
      ).statusCode,
    ).toBe(404);
    // Others never.
    expect((await transcript(omar)).statusCode).toBe(404);
    expect((await api(ctx, amira, 'GET', '/v1/me/chaperone')).json().chaperone).toMatchObject({
      displayName: 'Fatima',
      lastViewedAt: expect.any(String),
    });
    const { rows } = await q(`SELECT 1 FROM audit_logs WHERE action = 'chaperone.viewed'`);
    expect(rows.length).toBe(1);
  });

  it('both sides of the chat see the notice', async () => {
    expect((await page(yusuf)).chaperones).toEqual({ mine: null, theirs: null });
    await api(ctx, fatima, 'POST', '/v1/chaperone/join', { token: await invite() });
    expect((await page(yusuf)).chaperones).toEqual({
      mine: null,
      theirs: { displayName: 'Fatima', since: expect.any(String) },
    });
    expect((await page(amira)).chaperones).toEqual({
      mine: { displayName: 'Fatima', since: expect.any(String) },
      theirs: null,
    });
  });

  it('one at a time; removing or stepping down ends access at once', async () => {
    await api(ctx, fatima, 'POST', '/v1/chaperone/join', { token: await invite() });
    expect(
      (await api(ctx, omar, 'POST', '/v1/chaperone/join', { token: await invite() })).statusCode,
    ).toBe(409);
    expect((await api(ctx, amira, 'DELETE', '/v1/me/chaperone')).statusCode).toBe(200);
    expect((await transcript()).statusCode).toBe(404);
    expect((await page(yusuf)).chaperones.theirs).toBeNull();
    await api(ctx, fatima, 'POST', '/v1/chaperone/join', { token: await invite() });
    expect((await api(ctx, fatima, 'DELETE', `/v1/chaperoning/${amira.id}`)).statusCode).toBe(200);
    expect((await transcript()).statusCode).toBe(404);
    // Friends-mode chats are never included; an ended match closes too.
    await api(ctx, fatima, 'POST', '/v1/chaperone/join', { token: await invite() });
    await api(ctx, yusuf, 'DELETE', `/v1/matches/${matchId}`);
    expect((await transcript()).statusCode).toBe(404);
  });

  it('in "Download my data", for both', async () => {
    await api(ctx, fatima, 'POST', '/v1/chaperone/join', { token: await invite() });
    for (const [m, role, name] of [
      [amira, 'my_chaperone', 'Fatima'],
      [fatima, 'i_chaperone', 'Amira'],
    ] as const) {
      const zip = await api(ctx, m, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.chaperones).toEqual([expect.objectContaining({ role, name })]);
    }
  });
});
