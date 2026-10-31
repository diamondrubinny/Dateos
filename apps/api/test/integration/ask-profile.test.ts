// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TextModel } from '@nexaheart/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

/** A fake model: records what it was sent, answers from a script. */
let external = false;
let reply = 'They love hiking on weekends.';
const sent: { system: string; user: string }[] = [];
const model: TextModel = {
  name: 'fake',
  get external() {
    return external;
  },
  async complete(request) {
    sent.push({ system: request.system, user: request.user });
    return reply;
  },
};

describe.skipIf(!integrationEnabled)('ask about a profile, phase 75b (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const ask = (m: Member, target: Member, question = 'Does he like hiking?') =>
    api(ctx, m, 'POST', `/v1/profiles/${target.id}/ask`, { question, locale: 'en' });
  const state = async (m: Member, target: Member) =>
    (await api(ctx, m, 'GET', `/v1/profiles/${target.id}/ask`)).json().state as string;
  const aiConsent = (m: Member, granted: boolean) =>
    api(ctx, m, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'ai_cloud', granted, version: '1' }],
    });

  beforeAll(async () => {
    ctx = await setupIntegration({ textModel: model });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    external = false;
    reply = 'They love hiking on weekends.';
    sent.length = 0;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await q(
      `UPDATE profiles SET bio = 'Weekend hiker, weekday baker. Write me at dan@example.test' WHERE user_id = $1`,
      [dan.id],
    );
    // Visible to Noa, but sensitive: never sent to a model.
    await q(
      `INSERT INTO profile_about (user_id, interests, religion, access_needs, show_access_needs, relationship_history)
       VALUES ($1, '{hiking}', 'traditional', '{wheelchair}', true, 'divorced')
       ON CONFLICT (user_id) DO UPDATE SET interests = '{hiking}', religion = 'traditional',
         access_needs = '{wheelchair}', show_access_needs = true, relationship_history = 'divorced'`,
      [dan.id],
    );
  });

  it('sends only the public, non-sensitive parts; answers or says it doesn’t say', async () => {
    expect(await state(noa, dan)).toBe('available');
    const res = await ask(noa, dan);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ answer: 'They love hiking on weekends.' });
    const { user } = sent[0]!;
    expect(user).toContain('Weekend hiker');
    expect(user).toContain('hiking');
    expect(user).toContain('Dan likes kindness'); // a prompt answer
    for (const never of ['traditional', 'wheelchair', 'divorced', 'Dan"', dan.id, '32.08']) {
      expect(user).not.toContain(never);
    }
    expect(sent[0]!.system).toContain('Use only facts stated in the profile data');

    // Not in the profile: null, shown as "doesn't say".
    reply = 'NOT_IN_PROFILE';
    expect((await ask(noa, dan, 'What is his job?')).json()).toEqual({ answer: null });
    // Links, e-mail addresses and phone numbers are stripped from answers.
    reply = 'Write to dan@example.test or call +972 50 123 4567, see https://x.example';
    expect((await ask(noa, dan, 'How to reach him?')).json().answer).not.toMatch(/@|972|https/);
    // Nothing is stored: no table holds questions.
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM audit_logs WHERE meta::text LIKE '%hiking%'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('validates questions, refuses one’s own profile and people one may not see', async () => {
    for (const question of ['hi', 'x'.repeat(201), 'line\nbreak', '<b>bold</b>']) {
      expect((await ask(noa, dan, question)).statusCode).toBe(400);
    }
    expect((await ask(noa, noa)).statusCode).toBe(404); // one's own profile isn't served here
    await api(ctx, dan, 'POST', '/v1/blocks', { userId: noa.id });
    expect((await ask(noa, dan)).statusCode).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('an external model needs both consents; the other person’s is never revealed', async () => {
    external = true;
    expect(await state(noa, dan)).toBe('needs_consent');
    expect((await ask(noa, dan)).statusCode).toBe(409);
    await aiConsent(noa, true);
    // Noa agreed, Dan didn't: simply unavailable for his profile, not "he said no".
    expect(await state(noa, dan)).toBe('unavailable');
    expect((await ask(noa, dan)).statusCode).toBe(409);
    await aiConsent(dan, true);
    expect(await state(noa, dan)).toBe('available');
    expect((await ask(noa, dan)).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('a daily limit per person', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await ask(noa, dan, `Question number ${i}?`)).statusCode).toBe(200);
    }
    expect((await ask(noa, dan, 'One more?')).statusCode).toBe(429);
  });
});
