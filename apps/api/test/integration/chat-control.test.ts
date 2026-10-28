// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { messagesPageSchema, messageViewSchema } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeUnsent } from '../../../worker/src/profile-jobs.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)(
  'chat control: unsend, replies, read receipts (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let dan: Member;
    let matchId: string;
    let n = 0;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
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

    const send = (m: Member, text: string, replyToId?: string) =>
      api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
        text,
        clientId: `c-${Date.now()}-${(n += 1)}`,
        ...(replyToId ? { replyToId } : {}),
      });
    const unsend = (m: Member, id: string, match = matchId) =>
      api(ctx, m, 'DELETE', `/v1/matches/${match}/messages/${id}`);
    const page = async (m: Member) =>
      messagesPageSchema.parse(
        (await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`)).json(),
      );

    describe('unsend', () => {
      it('hides my message from both of us, within 15 minutes, and only mine', async () => {
        const id = (await send(dan, 'Oops, wrong chat')).json().id as string;
        await api(ctx, noa, 'PUT', `/v1/matches/${matchId}/messages/${id}/reaction`, {
          emoji: '😂',
        });
        // Noa can't unsend Dan's message; it looks like it doesn't exist.
        expect((await unsend(noa, id)).statusCode).toBe(404);
        const res = await unsend(dan, id);
        expect(res.statusCode).toBe(200);
        expect(messageViewSchema.parse(res.json())).toMatchObject({ unsent: true, body: null });
        for (const m of [noa, dan]) {
          const msg = (await page(m)).messages.find((x) => x.id === id)!;
          expect(msg).toMatchObject({
            unsent: true,
            body: null,
            reactions: { mine: null, theirs: null },
          });
          expect(JSON.stringify(await page(m))).not.toContain('wrong chat');
        }
        // Idempotent.
        expect((await unsend(dan, id)).statusCode).toBe(200);
        const audits = await q(`SELECT target_id FROM audit_logs WHERE action = 'message.unsent'`);
        expect(audits.rows).toEqual([{ target_id: id }]);
        // The content stays on the server, for moderation only.
        const stored = await q('SELECT body, unsent_at FROM messages WHERE id = $1', [id]);
        expect(stored.rows[0].body).toBe('Oops, wrong chat');
      });

      it('refuses after 15 minutes', async () => {
        const id = (await send(dan, 'Too late')).json().id as string;
        await q(`UPDATE messages SET created_at = now() - interval '16 minutes' WHERE id = $1`, [
          id,
        ]);
        expect((await unsend(dan, id)).statusCode).toBe(409);
      });

      it('goes into a report automatically, then is purged after 30 days', async () => {
        const kept = (await send(dan, 'You will regret ignoring me')).json().id as string;
        await unsend(dan, kept);
        const res = await api(ctx, noa, 'POST', '/v1/reports', {
          targetId: dan.id,
          category: 'harassment',
          details: 'He deleted a threat',
          messageIds: [],
        });
        expect(res.statusCode).toBe(201);
        const evidence = await q('SELECT body, unsent, from_reported FROM report_evidence');
        expect(evidence.rows).toEqual([
          { body: 'You will regret ignoring me', unsent: true, from_reported: true },
        ]);
        // A month later the chat copy is purged; the report keeps its evidence.
        await q(`UPDATE messages SET unsent_at = now() - interval '31 days' WHERE id = $1`, [kept]);
        const purged = await purgeUnsent(ctx.services.dbHandle.db, ctx.services.storage);
        expect(purged.unsentPurged).toBe(1);
        expect(
          (await q('SELECT body FROM messages WHERE id = $1', [kept])).rows[0].body,
        ).toBeNull();
        expect((await q('SELECT count(*)::int AS n FROM report_evidence')).rows[0].n).toBe(1);
        const row = await q('SELECT unsent_at FROM messages WHERE id = $1', [kept]);
        expect(row.rows[0].unsent_at).not.toBeNull();
      });
    });

    describe('replies', () => {
      it('quotes a message of the same chat, as much as each person may see', async () => {
        const first = (await send(noa, 'Do you like hiking?')).json().id as string;
        const reply = await send(dan, 'Love it!', first);
        expect(reply.statusCode).toBe(200);
        const quoted = (await page(noa)).messages.find((x) => x.body === 'Love it!')!;
        expect(quoted.replyTo).toEqual({
          id: first,
          mine: true,
          kind: 'text',
          preview: 'Do you like hiking?',
          state: 'shown',
        });
        // Unsent: the quote says so, without the text.
        const second = (await send(dan, 'Secret plan')).json().id as string;
        await send(noa, 'What plan?', second);
        await unsend(dan, second);
        const afterUnsend = (await page(noa)).messages.find((x) => x.body === 'What plan?')!;
        expect(afterUnsend.replyTo).toMatchObject({ state: 'unsent', preview: null });
      });

      it('a harmful message stays hidden in a quote, for its receiver', async () => {
        const harmful = (await send(dan, 'send nudes')).json().id as string;
        await send(dan, 'did you see?', harmful);
        const forNoa = (await page(noa)).messages.find((x) => x.body === 'did you see?')!;
        expect(forNoa.replyTo).toMatchObject({ state: 'hidden', preview: null });
        const forDan = (await page(dan)).messages.find((x) => x.body === 'did you see?')!;
        expect(forDan.replyTo).toMatchObject({ state: 'shown', preview: 'send nudes' });
      });

      it('refuses a message from another chat', async () => {
        const eve = await createMember(ctx, {
          name: 'Eve',
          gender: 'woman',
          interestedIn: ['man'],
        });
        await api(ctx, eve, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
        const other = (
          await api(ctx, dan, 'POST', '/v1/interactions', { targetId: eve.id, kind: 'like' })
        ).json().matchId as string;
        const elsewhere = (
          await api(ctx, eve, 'POST', `/v1/matches/${other}/messages`, {
            text: 'private to Dan and Eve',
            clientId: `c-other-${Date.now()}`,
          })
        ).json().id as string;
        expect((await send(noa, 'sneaky', elsewhere)).statusCode).toBe(400);
        // And unsending across chats is "not found" too.
        expect((await unsend(eve, elsewhere, matchId)).statusCode).toBe(404);
      });
    });

    describe('read receipts', () => {
      it('are shown only when both have them on', async () => {
        await send(dan, 'Hi Noa');
        await api(ctx, noa, 'POST', `/v1/matches/${matchId}/read`);
        expect((await page(dan)).otherReadAt).not.toBeNull();
        expect(
          (await api(ctx, noa, 'PUT', '/v1/me/settings', { readReceipts: false })).statusCode,
        ).toBe(200);
        expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().readReceipts).toBe(false);
        // Dan no longer sees Noa's, and Noa doesn't see Dan's either.
        expect((await page(dan)).otherReadAt).toBeNull();
        await send(noa, 'Hi Dan');
        await api(ctx, dan, 'POST', `/v1/matches/${matchId}/read`);
        expect((await page(noa)).otherReadAt).toBeNull();
        // Unread counts still work.
        await send(dan, 'Another one');
        const inbox = (await api(ctx, noa, 'GET', '/v1/conversations')).json().conversations;
        expect(inbox[0].unread).toBe(1);
      });
    });
  },
);
