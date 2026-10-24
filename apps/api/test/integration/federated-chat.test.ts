// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  FEDERATION_CONSENT_VERSION,
  type FederatedMatch,
  type FederatedMessagesPage,
  type FederatedProfile,
} from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';
import { A_URL, B_URL, bridge } from './two-servers.js';

describe.skipIf(!integrationEnabled)('partner communities: chat (integration)', () => {
  let a: TestContext;
  let b: TestContext;
  const qa = (sql: string, params: unknown[] = []) => a.services.dbHandle.pool.query(sql, params);
  const qb = (sql: string, params: unknown[] = []) => b.services.dbHandle.pool.query(sql, params);

  beforeAll(async () => {
    a = await setupIntegration({ federation: true, apiUrl: A_URL, fetch: bridge(B_URL, () => b) });
    b = await setupIntegration({
      federation: true,
      second: { suffix: 'b', redisDb: 14, apiUrl: B_URL },
      fetch: bridge(A_URL, () => a),
    });
  });
  afterAll(async () => {
    if (a) await teardown(a);
    if (b) await teardown(b);
  });

  let noa: Member;
  let dan: Member;
  let atA: FederatedMatch;
  let atB: FederatedMatch;

  const matchesOf = async (ctx: TestContext, m: Member): Promise<FederatedMatch[]> =>
    (await api(ctx, m, 'GET', '/v1/federated/matches')).json();
  const read = async (ctx: TestContext, m: Member, id: string): Promise<FederatedMessagesPage> => {
    const res = await api(ctx, m, 'GET', `/v1/federated/matches/${id}/messages`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  let n = 0;
  const send = (ctx: TestContext, m: Member, id: string, text: string, clientId?: string) =>
    api(ctx, m, 'POST', `/v1/federated/matches/${id}/messages`, {
      text,
      clientId: clientId ?? `client-${(n += 1)}-${Date.now()}`,
    });

  beforeEach(async () => {
    await resetState(a);
    await resetState(b);
    const idOf = async (ctx: TestContext, cookie: string) =>
      (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json().user
        .id as string;
    await a.services.federation.invite(
      await idOf(a, await signIn(a, 'admin-a@example.test')),
      B_URL,
    );
    await b.services.federation.accept(
      await idOf(b, await signIn(b, 'admin-b@example.test')),
      (await b.services.federation.list()).partners[0]!.id,
    );
    noa = await createMember(a, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(b, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    const pairs = [
      [a, noa],
      [b, dan],
    ] as const;
    for (const [ctx, m] of pairs) {
      await api(ctx, m, 'POST', '/v1/federated/join', { version: FEDERATION_CONSENT_VERSION });
    }
    for (const [ctx, m] of pairs) {
      const [card] = (await api(ctx, m, 'GET', '/v1/federated/deck')).json() as FederatedProfile[];
      await api(ctx, m, 'POST', '/v1/federated/interactions', {
        partnerId: card!.partnerId,
        alias: card!.alias,
        kind: 'like',
      });
    }
    atA = (await matchesOf(a, noa))[0]!;
    atB = (await matchesOf(b, dan))[0]!;
    expect(atA?.displayName).toBe('Dan');
    expect(atB?.displayName).toBe('Noa');
    expect(atA?.lastMessage).toBeNull();
  });

  it('a message goes server to server; each side keeps its own copy; unread and push', async () => {
    const sent = await send(a, noa, atA.id, 'Hi Dan, how is Haifa?');
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json()).toMatchObject({ mine: true, body: 'Hi Dan, how is Haifa?', hidden: false });

    // Dan's side: the preview, one unread, and a content-free push.
    const [dm] = await matchesOf(b, dan);
    expect(dm!.lastMessage).toMatchObject({ body: 'Hi Dan, how is Haifa?', mine: false });
    expect(dm!.unread).toBe(1);
    expect(b.jobs.push).toContainEqual({
      userId: dan.id,
      kind: 'partner_message',
      matchId: dm!.id,
    });
    const page = await read(b, dan, atB.id);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ mine: false, body: 'Hi Dan, how is Haifa?' });
    // The same message id on both servers; opening the chat marks it read (there only).
    expect(page.messages[0]!.id).toBe(sent.json().id);
    expect((await matchesOf(b, dan))[0]!.unread).toBe(0);

    // Dan answers; Noa reads both, newest first.
    expect((await send(b, dan, atB.id, 'Windy! And Tel Aviv?')).statusCode).toBe(201);
    const mine = await read(a, noa, atA.id);
    expect(mine.messages.map((m) => [m.mine, m.body])).toEqual([
      [false, 'Windy! And Tel Aviv?'],
      [true, 'Hi Dan, how is Haifa?'],
    ]);
    expect((await qa('SELECT count(*)::int AS n FROM federation_messages')).rows[0].n).toBe(2);
    expect((await qb('SELECT count(*)::int AS n FROM federation_messages')).rows[0].n).toBe(2);
  });

  it('a retry with the same id is never sent twice', async () => {
    const first = (await send(a, noa, atA.id, 'Hello!', 'retry-client-1')).json();
    const again = (await send(a, noa, atA.id, 'Hello!', 'retry-client-1')).json();
    expect(again.id).toBe(first.id);
    expect((await read(b, dan, atB.id)).messages).toHaveLength(1);
  });

  it('the receiving community runs its own filters', async () => {
    const harmful = await send(b, dan, atB.id, 'send nudes');
    expect(harmful.json()).toMatchObject({ mine: true, hidden: false, harm: [] });
    await send(b, dan, atB.id, 'can you send me money for my ticket?');
    const page = await read(a, noa, atA.id);
    expect(page.messages[1]).toMatchObject({ mine: false, hidden: true, harm: ['sexual'] });
    expect(page.messages[0]).toMatchObject({ hidden: false, scam: ['money'] });
    expect((await matchesOf(a, noa))[0]!.lastMessage?.hidden).toBe(false);
  });

  it('ends with the match on both sides', async () => {
    await send(a, noa, atA.id, 'Hi!');
    // Noa unmatches: the conversation is deleted here and there.
    expect((await api(a, noa, 'DELETE', `/v1/federated/matches/${atA.id}`)).statusCode).toBe(200);
    expect((await qa('SELECT count(*)::int AS n FROM federation_messages')).rows[0].n).toBe(0);
    expect((await qb('SELECT count(*)::int AS n FROM federation_messages')).rows[0].n).toBe(0);
    expect((await send(b, dan, atB.id, 'Still there?')).statusCode).toBe(404);
    expect((await send(a, noa, atA.id, 'Oops')).statusCode).toBe(404);
  });

  it('a match the other side no longer has ends here when writing', async () => {
    // As if B's unmatch never reached A.
    await qb('DELETE FROM federation_matches');
    const res = await send(a, noa, atA.id, 'Hello?');
    expect(res.statusCode).toBe(410);
    expect(await matchesOf(a, noa)).toEqual([]);
    expect((await qa('SELECT count(*)::int AS n FROM federation_messages')).rows[0].n).toBe(0);
  });

  it('only the two people in the match, and only signed', async () => {
    const eve = await createMember(a, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await send(a, eve, atA.id, 'Hi')).statusCode).toBe(404);
    expect((await api(a, eve, 'GET', `/v1/federated/matches/${atA.id}/messages`)).statusCode).toBe(
      404,
    );
    const unsigned = await b.app.inject({
      method: 'POST',
      url: '/v1/federation/messages',
      payload: { from: 'x', to: 'y', id: atA.id, body: 'hi' },
    });
    expect(unsigned.statusCode).toBe(401);
    // Too long for a message.
    expect((await send(a, noa, atA.id, 'x'.repeat(2001))).statusCode).toBe(400);
  });
});
