// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, discoverIds } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('blocked people (integration)', () => {
  let ctx: TestContext;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  it('lists my blocks by name only, newest first, and only mine', async () => {
    const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    const eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    await q(`UPDATE blocks SET created_at = now() - interval '1 hour' WHERE blocked_id = $1`, [
      dan.id,
    ]);
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: eli.id });

    const res = await api(ctx, noa, 'GET', '/v1/blocks');
    expect(res.statusCode).toBe(200);
    const { blocked } = res.json() as { blocked: Record<string, unknown>[] };
    expect(blocked.map((b) => b.displayName)).toEqual(['Eli', 'Dan']);
    expect(Object.keys(blocked[0]!).sort()).toEqual(['blockedAt', 'displayName', 'userId']);

    // Dan sees none of Noa's blocks; his own list is empty.
    expect((await api(ctx, dan, 'GET', '/v1/blocks')).json()).toEqual({ blocked: [] });
  });

  it('unblocking lets someone never matched appear again, silently', async () => {
    const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    expect(await discoverIds(ctx, noa)).not.toContain(dan.id);

    const res = await api(ctx, noa, 'DELETE', `/v1/blocks/${dan.id}`);
    expect(res.statusCode).toBe(200);
    expect(await discoverIds(ctx, noa)).toContain(dan.id);
    expect((await api(ctx, noa, 'GET', '/v1/blocks')).json()).toEqual({ blocked: [] });

    const { rows } = await q(`SELECT action, meta FROM audit_logs WHERE actor_id = $1`, [noa.id]);
    expect(rows.map((r) => r.action)).toContain('block.removed');
  });

  it('a match the block closed stays closed after unblocking', async () => {
    const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const like = await api(ctx, noa, 'POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    const matchId = like.json().matchId as string;
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    await api(ctx, noa, 'DELETE', `/v1/blocks/${dan.id}`);

    const { rows } = await q(`SELECT unmatched_at FROM matches WHERE id = $1`, [matchId]);
    expect(rows[0].unmatched_at).not.toBeNull();
    expect(await discoverIds(ctx, noa)).not.toContain(dan.id);
    const send = await api(ctx, dan, 'POST', `/v1/matches/${matchId}/messages`, {
      text: 'Hi again',
      clientId: 'after-unblock',
    });
    expect(send.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("can't remove someone else's block or one that doesn't exist", async () => {
    const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    // Dan tries to lift Noa's block on him.
    expect((await api(ctx, dan, 'DELETE', `/v1/blocks/${noa.id}`)).statusCode).toBe(404);
    expect((await api(ctx, noa, 'DELETE', '/v1/blocks/nobody')).statusCode).toBe(404);
    const { rows } = await q(`SELECT 1 FROM blocks WHERE blocker_id = $1`, [noa.id]);
    expect(rows).toHaveLength(1);
  });

  it('a deleted account leaves the list', async () => {
    const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    await q(`DELETE FROM "user" WHERE id = $1`, [dan.id]);
    expect((await api(ctx, noa, 'GET', '/v1/blocks')).json()).toEqual({ blocked: [] });
  });
});
