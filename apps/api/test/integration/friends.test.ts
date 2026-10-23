// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processFriendRetention } from '../../../worker/src/friend-jobs.js';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('friends (integration)', () => {
  let ctx: TestContext;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const woman = (name: string) =>
    createMember(ctx, { name, gender: 'woman', interestedIn: ['man'] });
  const man = (name: string) => createMember(ctx, { name, gender: 'man', interestedIn: ['woman'] });
  const friendMode = (m: Member, over: Record<string, unknown> = {}) =>
    api(ctx, m, 'PUT', '/v1/me/friend-mode', {
      on: true,
      ageMin: 18,
      ageMax: 100,
      genders: [],
      ...over,
    });
  const friendIds = async (m: Member) =>
    ((await api(ctx, m, 'GET', '/v1/friends/discover')).json().profiles as { id: string }[]).map(
      (p) => p.id,
    );
  const like = (m: Member, target: Member, mode?: 'date' | 'friend') =>
    api(ctx, m, 'POST', '/v1/interactions', {
      targetId: target.id,
      kind: 'like',
      ...(mode ? { mode } : {}),
    });

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  // ------------------------------------------------------------------ friends mode

  it('friends mode is its own deck, only between people who turned it on', async () => {
    const noa = await woman('Noa');
    const dana = await woman('Dana');
    const dan = await man('Dan');
    // Two women interested in men don't see each other for dating.
    expect(await discoverIds(ctx, noa)).not.toContain(dana.id);
    expect(await friendIds(noa)).toEqual([]); // friends mode off: empty deck
    expect((await api(ctx, noa, 'GET', '/v1/me/friend-mode')).json()).toMatchObject({ on: false });

    expect((await friendMode(noa)).statusCode).toBe(200);
    expect(await friendIds(noa)).toEqual([]); // Dana hasn't turned it on
    await friendMode(dana);
    expect(await friendIds(noa)).toEqual([dana.id]);
    expect(await friendIds(dana)).toEqual([noa.id]);
    // Friends mode never reaches the dating deck, and Dan (friends mode off) sees neither change.
    expect(await discoverIds(ctx, noa)).toEqual([dan.id]);
    expect(await friendIds(dan)).toEqual([]);

    // Optional genders, both ways.
    await friendMode(noa, { genders: ['man'] });
    expect(await friendIds(dana)).toEqual([]);
    await friendMode(noa, { genders: [] });
    // Ages, both ways.
    await friendMode(dana, { ageMin: 40, ageMax: 60 });
    expect(await friendIds(noa)).toEqual([]);
    await friendMode(dana);
    // Validation.
    expect((await friendMode(noa, { ageMin: 50, ageMax: 30 })).statusCode).toBe(400);
    expect((await friendMode(noa, { genders: ['man', 'man'] })).statusCode).toBe(400);
  });

  it('a friends match needs both likes in friends mode, and is labelled', async () => {
    const noa = await woman('Noa');
    const dana = await woman('Dana');
    const dan = await man('Dan');
    await friendMode(noa);
    await friendMode(dana);
    // A dating like on someone who is only a friends candidate isn't possible.
    expect((await like(noa, dana)).statusCode).toBe(404);
    expect((await like(noa, dana, 'friend')).json()).toMatchObject({ matched: false });
    const res = (await like(dana, noa, 'friend')).json();
    expect(res.matched).toBe(true);
    const inbox = (await api(ctx, noa, 'GET', '/v1/conversations')).json().conversations;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ matchId: res.matchId, mode: 'friend' });
    // A friend like doesn't show up in the dating "Likes You".
    await friendMode(dan);
    await like(noa, dan, 'friend');
    expect(
      (await api(ctx, dan, 'GET', '/v1/likes'))
        .json()
        .likes.map((l: { profile: { id: string } }) => l.profile.id),
    ).not.toContain(noa.id);
    // A dating like and a friends like don't make a match.
    const gil = await man('Gil');
    await friendMode(gil);
    await like(gil, noa, 'friend');
    const tali = await woman('Tali');
    await like(tali, gil, 'date');
    expect((await like(gil, tali, 'friend')).statusCode).toBe(404); // Tali's friends mode is off
  });

  // ------------------------------------------------------------------ friends' takes

  it('a friend writes a take without an account; the owner approves it', async () => {
    const noa = await woman('Noa');
    await q(`UPDATE profiles SET display_name = 'Noa Levi' WHERE user_id = $1`, [noa.id]);
    const dan = await man('Dan');
    const link = await api(ctx, noa, 'POST', '/v1/me/takes/link');
    expect(link.statusCode).toBe(201);
    const { token } = link.json();
    // Public: only her first name.
    const info = await ctx.app.inject({ method: 'GET', url: `/v1/takes/${token}` });
    expect(info.json()).toEqual({ name: 'Noa' });
    const write = (payload: object) =>
      ctx.app.inject({ method: 'POST', url: `/v1/takes/${token}`, payload });
    expect(
      (await write({ name: 'Maya', relation: 'friend', text: 'Call her at 054-1234567 anytime' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await write({ name: 'Maya', relation: 'friend', text: 'She is an idiot and a loser' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await write({ name: 'Maya', relation: 'enemy', text: 'Kind and very funny' })).statusCode,
    ).toBe(400);
    const take = {
      name: 'Maya',
      relation: 'friend',
      text: 'The kindest person I know, and very funny.',
    };
    expect((await write(take)).statusCode).toBe(201);
    // Single use.
    expect((await write(take)).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/takes/${token}` })).statusCode).toBe(
      404,
    );
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/v1/takes/${'x'.repeat(32)}` })).statusCode,
    ).toBe(404);

    // Not shown until approved; only the owner can approve.
    const profile = async () =>
      (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().friendTakes;
    expect(await profile()).toEqual([]);
    const [pending] = (await api(ctx, noa, 'GET', '/v1/me/takes')).json().takes;
    expect(pending).toMatchObject({ name: 'Maya', status: 'pending' });
    expect((await api(ctx, dan, 'POST', `/v1/me/takes/${pending.id}/approve`)).statusCode).toBe(
      404,
    );
    expect((await api(ctx, noa, 'POST', `/v1/me/takes/${pending.id}/approve`)).statusCode).toBe(
      200,
    );
    expect(await profile()).toEqual([
      { name: 'Maya', relation: 'friend', text: 'The kindest person I know, and very funny.' },
    ]);
    expect((await api(ctx, dan, 'DELETE', `/v1/me/takes/${pending.id}`)).statusCode).toBe(404);
    expect((await api(ctx, noa, 'DELETE', `/v1/me/takes/${pending.id}`)).statusCode).toBe(200);
    expect(await profile()).toEqual([]);
  });

  it('shows at most three takes, and the export holds them', async () => {
    const noa = await woman('Noa');
    const dan = await man('Dan');
    for (let i = 0; i < 4; i += 1) {
      const { token } = (await api(ctx, noa, 'POST', '/v1/me/takes/link')).json();
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/takes/${token}`,
        payload: {
          name: `Friend${i}`,
          relation: 'friend',
          text: `Take number ${i}, all good things.`,
        },
      });
    }
    for (const t of (await api(ctx, noa, 'GET', '/v1/me/takes')).json().takes) {
      await api(ctx, noa, 'POST', `/v1/me/takes/${t.id}/approve`);
    }
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().friendTakes).toHaveLength(
      3,
    );
  });

  // ------------------------------------------------------------------ double dates

  async function pair(a: Member, b: Member): Promise<string> {
    const { token } = (await api(ctx, a, 'POST', '/v1/pairs/invite')).json();
    const res = await api(ctx, b, 'POST', `/v1/pairs/join/${token}`);
    expect(res.statusCode).toBe(200);
    return res.json().id;
  }
  const pairIds = async (m: Member) =>
    ((await api(ctx, m, 'GET', '/v1/pairs/discover')).json().pairs as { id: string }[]).map(
      (p) => p.id,
    );

  it('pairs: one per person, links single use, the friend sees the pair', async () => {
    const noa = await woman('Noa');
    const dana = await woman('Dana');
    const eve = await woman('Eve');
    const { token } = (await api(ctx, noa, 'POST', '/v1/pairs/invite')).json();
    expect((await api(ctx, noa, 'POST', `/v1/pairs/join/${token}`)).statusCode).toBe(404); // own link
    const joined = await api(ctx, dana, 'POST', `/v1/pairs/join/${token}`);
    expect(joined.json()).toMatchObject({ friend: { id: noa.id, displayName: 'Noa' } });
    expect((await api(ctx, eve, 'POST', `/v1/pairs/join/${token}`)).statusCode).toBe(404); // used
    expect((await api(ctx, noa, 'POST', '/v1/pairs/invite')).statusCode).toBe(409); // already paired
    expect((await api(ctx, noa, 'GET', '/v1/me/pair')).json().pair.friend.id).toBe(dana.id);
    // My friend's photo is visible to me even though we're not dating candidates.
    const photoUrl = (await api(ctx, noa, 'GET', '/v1/me/pair')).json().pair.friend.photoUrl;
    expect(photoUrl).toBeTruthy();
    expect((await api(ctx, eve, 'GET', '/v1/pairs/discover')).statusCode).toBe(409); // no pair
    expect((await api(ctx, dana, 'DELETE', '/v1/me/pair')).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me/pair')).json().pair).toBeNull();
  });

  it('a pair sees another pair only when all four can see each other', async () => {
    const noa = await woman('Noa');
    const dana = await woman('Dana');
    const dan = await man('Dan');
    const gil = await man('Gil');
    const far = createMember(ctx, {
      name: 'Far',
      gender: 'man',
      interestedIn: ['woman'],
      at: { lat: 29.55, lng: 34.95 }, // Eilat: too far for Noa and Dana
    });
    const women = await pair(noa, dana);
    const men = await pair(dan, gil);
    expect(await pairIds(noa)).toEqual([men]);
    expect(await pairIds(gil)).toEqual([women]);
    // A pair with someone one of us can't see is never shown.
    const ido = await man('Ido');
    await pair(ido, await far);
    expect(await pairIds(dana)).toEqual([men]);
    // Dealbreakers count too: Dana won't see smokers, so a pair with a smoker disappears.
    await api(ctx, gil, 'PUT', '/v1/me/about', {
      interests: [],
      children: null,
      smoking: 'yes',
      drinking: null,
      heightCm: null,
      religion: null,
      openingQuestion: null,
    });
    await api(ctx, dana, 'PUT', '/v1/me/dealbreakers', {
      smokingOk: ['no'],
      childrenOk: [],
      religionOk: [],
      heightMin: null,
      heightMax: null,
    });
    expect(await pairIds(noa)).toEqual([]);
    expect((await api(ctx, noa, 'POST', `/v1/pairs/${men}/like`)).statusCode).toBe(404);
  });

  it('two pairs liking each other open a group chat of four; leaving closes it for all', async () => {
    const noa = await woman('Noa');
    const dana = await woman('Dana');
    const dan = await man('Dan');
    const gil = await man('Gil');
    const eve = await woman('Eve');
    const women = await pair(noa, dana);
    const men = await pair(dan, gil);
    expect((await api(ctx, noa, 'POST', `/v1/pairs/${men}/like`)).json()).toEqual({
      doubleId: null,
    });
    // My friend already decided for our pair.
    expect((await api(ctx, dana, 'POST', `/v1/pairs/${men}/like`)).statusCode).toBe(409);
    expect(await pairIds(dana)).toEqual([]);
    const { doubleId } = (await api(ctx, gil, 'POST', `/v1/pairs/${women}/like`)).json();
    expect(doubleId).toBeTruthy();

    const doubles = (await api(ctx, dana, 'GET', '/v1/doubles')).json().doubles;
    expect(doubles).toHaveLength(1);
    expect(doubles[0].members.map((m: { id: string }) => m.id).sort()).toEqual(
      [noa.id, dan.id, gil.id].sort(),
    );
    const send = (m: Member, text: string) =>
      api(ctx, m, 'POST', `/v1/doubles/${doubleId}/messages`, {
        text,
        clientId: `dbl-${(n += 1)}-xxxx`,
      });
    expect((await send(noa, 'Hi both! Coffee on Friday?')).statusCode).toBe(200);
    expect((await send(dan, 'You are a stupid idiot')).statusCode).toBe(200);
    const seen = (await api(ctx, gil, 'GET', `/v1/doubles/${doubleId}/messages`)).json().messages;
    expect(seen.map((m: { text: string }) => m.text)).toContain('Hi both! Coffee on Friday?');
    // The harmful one arrives hidden for the others, not for its sender.
    expect(seen.find((m: { senderId: string }) => m.senderId === dan.id).hidden).toBe(true);
    // Outsiders: 404.
    expect((await api(ctx, eve, 'GET', `/v1/doubles/${doubleId}/messages`)).statusCode).toBe(404);
    expect((await send(eve, 'hello')).statusCode).toBe(404);
    // They can report each other (they had contact), even after it closes.
    expect((await api(ctx, gil, 'POST', `/v1/doubles/${doubleId}/leave`)).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/doubles')).json().doubles[0].closed).toBe(true);
    expect((await send(noa, 'still there?')).statusCode).toBe(409);
    expect(await ctx.services.discovery.hasContact(noa.id, dan.id)).toBe(true);

    // Retention: messages go 30 days after closing.
    await q(`UPDATE double_matches SET closed_at = now() - interval '31 days'`);
    expect((await processFriendRetention(ctx.services.dbHandle.db)).messages).toBe(2);
  });

  it('a block between any two of the four closes their double chat', async () => {
    const noa = await woman('Noa');
    const dana = await woman('Dana');
    const dan = await man('Dan');
    const gil = await man('Gil');
    const women = await pair(noa, dana);
    const men = await pair(dan, gil);
    await api(ctx, noa, 'POST', `/v1/pairs/${men}/like`);
    const { doubleId } = (await api(ctx, dan, 'POST', `/v1/pairs/${women}/like`)).json();
    await api(ctx, dana, 'POST', '/v1/blocks', { userId: gil.id });
    // The listener runs after the response; give it a moment.
    for (let i = 0; i < 20; i += 1) {
      const { rows } = await q(`SELECT closed_at FROM double_matches WHERE id = $1`, [doubleId]);
      if (rows[0].closed_at) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect((await api(ctx, noa, 'GET', '/v1/doubles')).json().doubles[0].closed).toBe(true);
  });
});
