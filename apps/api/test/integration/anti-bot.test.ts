// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('anti-bot and fake profiles (integration)', () => {
  let ctx: TestContext;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const settle = () => new Promise((r) => setTimeout(r, 150));
  const autoReports = async (id: string) =>
    (
      await q(
        `SELECT category, priority, details FROM reports WHERE reported_id = $1 AND automatic ORDER BY category`,
        [id],
      )
    ).rows as { category: string; priority: string; details: string }[];
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  /** A sender matched with `count` people, one chat each. */
  async function chats(count: number) {
    const sender = await createMember(ctx, { name: 'Bot', gender: 'man', interestedIn: ['woman'] });
    const matchIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const her = await createMember(ctx, {
        name: `Her${i}`,
        gender: 'woman',
        interestedIn: ['man'],
      });
      await api(ctx, her, 'POST', '/v1/interactions', { targetId: sender.id, kind: 'like' });
      const res = await api(ctx, sender, 'POST', '/v1/interactions', {
        targetId: her.id,
        kind: 'like',
      });
      matchIds.push(res.json().matchId);
    }
    let n = 0;
    const send = (matchId: string, text: string) =>
      api(ctx, sender, 'POST', `/v1/matches/${matchId}/messages`, {
        text,
        clientId: `c-${Date.now()}-${(n += 1)}`,
      });
    return { sender, matchIds, send };
  }

  describe('bot behaviour', () => {
    it('the same message to 5 chats opens one spam report; 4 chats don’t', async () => {
      const { sender, matchIds, send } = await chats(6);
      for (const id of matchIds.slice(0, 4)) await send(id, 'Hey   gorgeous, check my profile!');
      await settle();
      expect(await autoReports(sender.id)).toEqual([]);
      await send(matchIds[4]!, 'hey gorgeous, CHECK my profile!');
      await settle();
      await send(matchIds[5]!, 'Hey gorgeous, check my profile!');
      await settle();
      const reports = await autoReports(sender.id);
      expect(reports).toEqual([expect.objectContaining({ category: 'spam', priority: 'normal' })]);
      expect(reports[0]!.details).toContain('same message');
      // The messages themselves were delivered: nothing is blocked automatically.
      expect((await q('SELECT count(*)::int AS n FROM messages')).rows[0].n).toBe(6);
    });

    it('scam signals from a new account in 3 chats open a high-priority scam report', async () => {
      const { sender, matchIds, send } = await chats(3);
      for (const id of matchIds) await send(id, 'Add me on telegram, and lend me $200');
      await settle();
      expect(await autoReports(sender.id)).toEqual([
        expect.objectContaining({ category: 'scam', priority: 'high' }),
      ]);
    });

    it('…but not from an account older than a day', async () => {
      const { sender, matchIds, send } = await chats(3);
      await q(`UPDATE "user" SET created_at = now() - interval '3 days' WHERE id = $1`, [
        sender.id,
      ]);
      for (const id of matchIds) await send(id, 'Add me on telegram, and lend me $200');
      await settle();
      expect(await autoReports(sender.id)).toEqual([]);
    });

    it('more than 40 likes in 10 minutes slows down; 3 bursts in a day open a report', async () => {
      const liker = await createMember(ctx, {
        name: 'Fast',
        gender: 'man',
        interestedIn: ['woman'],
      });
      const target = await createMember(ctx, {
        name: 'Target',
        gender: 'woman',
        interestedIn: ['man'],
      });
      // 40 recent likes (inserted directly; their targets don't matter here).
      const fillLikes = async () => {
        for (let i = 0; i < 40; i += 1) {
          const id = `burst-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await q(
            `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $1, $1 || '@example.test', true, now(), now())`,
            [id],
          );
          await q(`INSERT INTO interactions (actor_id, target_id, kind) VALUES ($1, $2, 'like')`, [
            liker.id,
            id,
          ]);
        }
      };
      await fillLikes();
      const like = () =>
        api(ctx, liker, 'POST', '/v1/interactions', { targetId: target.id, kind: 'like' });
      const slowed = await like();
      expect(slowed.statusCode).toBe(429);
      expect(slowed.json().error.code).toBe('SLOW_DOWN');
      // Passing is still possible.
      expect(
        (await api(ctx, liker, 'POST', '/v1/interactions', { targetId: target.id, kind: 'pass' }))
          .statusCode,
      ).toBe(200);
      expect(await autoReports(liker.id)).toEqual([]);
      // Two more bursts in other windows today → a report.
      for (let i = 0; i < 2; i += 1) {
        await q(
          `UPDATE audit_logs SET created_at = created_at - interval '11 minutes' WHERE actor_id = $1 AND action = 'interaction.burst'`,
          [liker.id],
        );
        await q(`DELETE FROM interactions WHERE actor_id = $1 AND kind = 'pass'`, [liker.id]);
        await like();
      }
      expect(await autoReports(liker.id)).toEqual([expect.objectContaining({ category: 'spam' })]);
    });
  });

  describe('fake profiles', () => {
    const bio = 'Adventurous soul who loves sunsets, long walks and honest conversations.';

    it('copied profile text opens a report on the copy', async () => {
      const original = await createMember(ctx, {
        name: 'Real',
        gender: 'woman',
        interestedIn: ['man'],
        bio,
      });
      await settle();
      expect(await autoReports(original.id)).toEqual([]);
      const copy = await createMember(ctx, {
        name: 'Copy',
        gender: 'woman',
        interestedIn: ['man'],
        bio: bio.toUpperCase().replace(/ /g, '  '),
      });
      await settle();
      expect(await autoReports(copy.id)).toEqual([
        expect.objectContaining({ category: 'fake_profile', priority: 'normal' }),
      ]);
      // The original isn't reported, and short common answers never count.
      expect(await autoReports(original.id)).toEqual([]);
    });

    it('“Verified profiles only” shows only people a moderator verified', async () => {
      const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      const ori = await createMember(ctx, { name: 'Ori', gender: 'man', interestedIn: ['woman'] });
      await q(`UPDATE profiles SET verified_at = now() WHERE user_id = $1`, [ori.id]);
      const deck = async (m: Member) =>
        ((await api(ctx, m, 'GET', '/v1/discover')).json().profiles as { id: string }[])
          .map((p) => p.id)
          .sort();
      expect(await deck(noa)).toEqual([dan.id, ori.id].sort());
      const prefs = {
        ageMin: 18,
        ageMax: 99,
        maxDistanceKm: 50,
        intentions: [],
        verifiedOnly: true,
      };
      expect((await api(ctx, noa, 'PUT', '/v1/me/preferences', prefs)).statusCode).toBe(200);
      expect((await api(ctx, noa, 'GET', '/v1/me')).json().preferences.verifiedOnly).toBe(true);
      expect(await deck(noa)).toEqual([ori.id]);
      // Saving preferences without the field keeps the choice.
      await api(ctx, noa, 'PUT', '/v1/me/preferences', {
        ageMin: 18,
        ageMax: 99,
        maxDistanceKm: 50,
        intentions: [],
      });
      expect(await deck(noa)).toEqual([ori.id]);
    });
  });
});
