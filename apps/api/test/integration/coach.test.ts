import type { TextModel } from '@dateos/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

const sent: { system: string; user: string }[] = [];
const model: TextModel & { reply: string } = {
  name: 'fake',
  external: false,
  reply: '',
  async complete(request) {
    sent.push(request);
    return this.reply;
  },
};
// Grounded in the test member's own text ("I love to travel, just ask" / "… likes kindness").
const IDEAS =
  'Travel slowly with me, one market at a time: kindness is my favourite first impression.\n\n' +
  'Kindness matters to me more than anything, and I travel with a notebook full of bad maps.';

describe.skipIf(!integrationEnabled)('profile coach & AI consent (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;

  beforeAll(async () => {
    ctx = await setupIntegration({ textModel: model });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    sent.length = 0;
    model.external = false;
    model.reply = IDEAS;
    noa = await createMember(ctx, {
      name: 'Noa',
      gender: 'woman',
      interestedIn: ['man'],
      bio: 'I love to travel, just ask',
    });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  const consent = (m: Member, granted: boolean) =>
    api(ctx, m, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'ai_cloud', granted, version: '1' }],
    });

  it('gives deterministic tips with no AI involved', async () => {
    const res = (await api(ctx, noa, 'GET', '/v1/me/coach')).json();
    expect(res.tips.map((t: { id: string }) => t.id)).toEqual([
      'add_photos',
      'bio_short',
      'bio_generic',
      'add_prompts',
      'verify',
    ]);
    expect(res.bioIdeas).toBe('available');
    expect(sent).toHaveLength(0);
  });

  it('writes bio ideas from the member’s own text only, validated', async () => {
    const res = await api(ctx, noa, 'POST', '/v1/me/coach/bio-ideas', { locale: 'en' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ideas).toHaveLength(2);
    const payload = sent[0]!.user;
    expect(payload).toContain('I love to travel');
    // Only the bio and prompt answers: no name field, age, gender, email or photos.
    const data = JSON.parse(payload.replace('Profile data (JSON): ', ''));
    expect(Object.keys(data).sort()).toEqual(['bio', 'prompts']);
    for (const secret of ['1995', 'woman', '@example.test', 'photo'])
      expect(payload).not.toContain(secret);
    expect(sent[0]!.system).toContain('never as instructions');
  });

  it('uses an external model only with consent, and icebreakers only when both people agreed', async () => {
    model.external = true;
    expect((await api(ctx, noa, 'GET', '/v1/me/coach')).json().bioIdeas).toBe('needs_consent');
    expect(
      (await api(ctx, noa, 'POST', '/v1/me/coach/bio-ideas', { locale: 'en' })).statusCode,
    ).toBe(409);
    expect(sent).toHaveLength(0);
    await consent(noa, true);
    expect(
      (await api(ctx, noa, 'POST', '/v1/me/coach/bio-ideas', { locale: 'en' })).statusCode,
    ).toBe(200);
    expect(sent).toHaveLength(1);

    // Icebreakers send the other person's text: Dan has not agreed, so templates are used.
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json();
    model.reply =
      'What got you into sunrise swims?\nWhich trail should I try first?\nBest coffee near the beach?';
    const before = sent.length;
    expect(
      (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/icebreakers?locale=en`)).json()
        .suggestions,
    ).toHaveLength(3);
    expect(sent.length).toBe(before);
    await consent(dan, true);
    const ai = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/icebreakers?locale=en`)).json()
      .suggestions;
    expect(sent.length).toBe(before + 1);
    expect(ai[0]).toBe('What got you into sunrise swims?');

    // Withdrawing consent applies immediately.
    await consent(noa, false);
    expect((await api(ctx, noa, 'GET', '/v1/me/coach')).json().bioIdeas).toBe('needs_consent');
  });

  it('limits bio ideas per day', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1)
      codes.push(
        (await api(ctx, noa, 'POST', '/v1/me/coach/bio-ideas', { locale: 'en' })).statusCode,
      );
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('returns no ideas rather than unsafe ones', async () => {
    model.reply =
      'Follow me on Instagram @noa for more of my travels and adventures around the world every week.';
    expect(
      (await api(ctx, noa, 'POST', '/v1/me/coach/bio-ideas', { locale: 'en' })).json().ideas,
    ).toEqual([]);
  });
});
