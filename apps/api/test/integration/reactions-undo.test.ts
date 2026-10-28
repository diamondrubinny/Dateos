// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { messagesPageSchema, undoPassResultSchema } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('undo a pass and reactions (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  describe('undo a pass', () => {
    const undo = (m: Member) => api(ctx, m, 'POST', '/v1/interactions/undo');
    const discoverIds = async (m: Member) =>
      ((await api(ctx, m, 'GET', '/v1/discover')).json().profiles as { id: string }[]).map(
        (p) => p.id,
      );

    it('brings back the last pass, once', async () => {
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'pass' });
      expect(await discoverIds(noa)).not.toContain(dan.id);
      const res = await undo(noa);
      expect(res.statusCode).toBe(200);
      const body = undoPassResultSchema.parse(res.json());
      expect(body.profile.id).toBe(dan.id);
      expect(body.mode).toBe('date');
      expect(await discoverIds(noa)).toContain(dan.id);
      // Nothing left to undo.
      expect((await undo(noa)).statusCode).toBe(404);
      // And Noa can decide again.
      const like = await api(ctx, noa, 'POST', '/v1/interactions', {
        targetId: dan.id,
        kind: 'like',
      });
      expect(like.statusCode).toBe(200);
    });

    it('never undoes a like, an old pass, or someone else’s pass', async () => {
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
      expect((await undo(noa)).statusCode).toBe(404);
      const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
      await api(ctx, eve, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'pass' });
      // Dan has nothing to undo, and Eve's pass is untouched.
      expect((await undo(dan)).statusCode).toBe(404);
      await q(`UPDATE interactions SET created_at = now() - interval '11 minutes'`);
      expect((await undo(eve)).statusCode).toBe(404);
      const left = await q(`SELECT kind FROM interactions WHERE actor_id = $1`, [eve.id]);
      expect(left.rows).toEqual([{ kind: 'pass' }]);
    });

    it('keeps the pass when the profile may no longer be shown', async () => {
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'pass' });
      await api(ctx, dan, 'POST', '/v1/blocks', { userId: noa.id });
      expect((await undo(noa)).statusCode).toBe(404);
      const left = await q(`SELECT kind FROM interactions WHERE actor_id = $1`, [noa.id]);
      expect(left.rows).toEqual([{ kind: 'pass' }]);
    });

    it('requires sign-in', async () => {
      const res = await ctx.app.inject({ method: 'POST', url: '/v1/interactions/undo' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('reactions', () => {
    let matchId: string;
    let n = 0;
    beforeEach(async () => {
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      matchId = (
        await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
      ).json().matchId;
    });
    const send = async (m: Member, text: string) =>
      (
        await api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
          text,
          clientId: `c-${Date.now()}-${(n += 1)}`,
        })
      ).json().id as string;
    const react = (m: Member, messageId: string, emoji: string | null, match = matchId) =>
      api(ctx, m, 'PUT', `/v1/matches/${match}/messages/${messageId}/reaction`, { emoji });
    const reactionsOf = async (m: Member, messageId: string) =>
      messagesPageSchema
        .parse((await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`)).json())
        .messages.find((x) => x.id === messageId)!.reactions;

    it('one reaction each, seen by both, replaced and removed', async () => {
      const id = await send(dan, 'Coffee on Friday?');
      expect((await react(noa, id, '❤️')).json().reactions).toEqual({ mine: '❤️', theirs: null });
      expect(await reactionsOf(dan, id)).toEqual({ mine: null, theirs: '❤️' });
      await react(dan, id, '👍');
      await react(noa, id, '🔥');
      expect(await reactionsOf(noa, id)).toEqual({ mine: '🔥', theirs: '👍' });
      expect((await q('SELECT count(*)::int AS n FROM message_reactions')).rows[0].n).toBe(2);
      await react(noa, id, null);
      expect(await reactionsOf(dan, id)).toEqual({ mine: '👍', theirs: null });
    });

    it('only the fixed emoji, only the two of them, only visible messages', async () => {
      const id = await send(dan, 'Hi!');
      expect((await react(noa, id, '💩')).statusCode).toBe(400);
      const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
      expect((await react(eve, id, '❤️')).statusCode).toBe(404);
      // A message id from another chat looks like one that doesn't exist.
      const other = await createMember(ctx, {
        name: 'Ori',
        gender: 'man',
        interestedIn: ['woman'],
      });
      await api(ctx, other, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      const otherMatch = (
        await api(ctx, noa, 'POST', '/v1/interactions', { targetId: other.id, kind: 'like' })
      ).json().matchId as string;
      expect((await react(noa, id, '❤️', otherMatch)).statusCode).toBe(404);
      // A harmful message is hidden for its receiver: no reactions.
      const harmful = await send(dan, 'send nudes');
      expect((await react(noa, harmful, '😂')).statusCode).toBe(409);
    });

    it('end with the match', async () => {
      const id = await send(dan, 'Hi!');
      await react(noa, id, '😮');
      await api(ctx, noa, 'DELETE', `/v1/matches/${matchId}`);
      expect((await react(noa, id, '😂')).statusCode).toBe(404);
    });
  });
});
