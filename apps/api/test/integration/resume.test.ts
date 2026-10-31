// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_RESUME_LINKS } from '@nexaheart/shared';
import { strFromU8, unzipSync } from 'fflate';
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

describe.skipIf(!integrationEnabled)('the matchmaking résumé, phase 68b (integration)', () => {
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

  const share = (body: Record<string, unknown>, m: Member = noa) =>
    api(ctx, m, 'POST', '/v1/me/resume-links', body);
  const get = (url: string) => ctx.app.inject({ method: 'GET', url });
  const mom = { label: 'Mom', days: 3, sections: ['photo', 'prompts'] };

  it('a link for one person: only what the member chose, never email or place', async () => {
    const res = await share(mom);
    expect(res.statusCode).toBe(200);
    const link = res.json();
    expect(link).toMatchObject({ label: 'Mom', sections: ['photo', 'prompts'], views: 0 });
    expect((Date.parse(link.expiresAt) - ctx.clock.value) / 86_400_000).toBeCloseTo(3);
    const page = await get(`/v1/resume/${link.token}`);
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    const card = page.json();
    expect(card).toMatchObject({
      label: 'Mom',
      displayName: 'Noa',
      gender: 'woman',
      intention: 'long_term',
      photoUrl: `/v1/resume/${link.token}/photo`,
      bio: null, // "about me" wasn't chosen
      about: null,
      faith: null,
      prompts: [{ promptKey: 'green_flag', answer: 'Noa likes kindness' }],
    });
    const body = JSON.stringify(card);
    expect(body).not.toMatch(/example\.test|distance|lat|matchNote/);
    // Opens are counted for the member.
    const mine = (await api(ctx, noa, 'GET', '/v1/me/resume-links')).json().links;
    expect(mine).toEqual([expect.objectContaining({ label: 'Mom', views: 1 })]);
    expect(JSON.stringify(mine)).not.toContain(link.token);
    const about = (await share({ label: 'Rivka', days: 1, sections: ['about'] })).json();
    expect((await get(`/v1/resume/${about.token}`)).json()).toMatchObject({
      bio: 'Hi, I am Noa',
      photoUrl: null,
      prompts: [],
    });
    expect((await get(`/v1/resume/${about.token}/photo`)).statusCode).toBe(404);
  });

  it('the photo is a watermarked copy, never the original', async () => {
    const { token } = (await share(mom)).json();
    const photo = await get(`/v1/resume/${token}/photo`);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/webp');
    expect(photo.headers['cache-control']).toBe('no-store');
    const original = await ctx.services.storage.get(
      ctx.services.storage.buckets.media,
      (await q('SELECT media_key FROM photos WHERE id = $1', [noa.photoId])).rows[0].media_key,
    );
    const chunks: Buffer[] = [];
    for await (const c of original.body) chunks.push(Buffer.from(c as Uint8Array));
    expect(Buffer.compare(Buffer.concat(chunks), photo.rawPayload)).not.toBe(0);
    // The plain purple square now has light text across it.
    const { channels } = await sharp(photo.rawPayload).stats();
    expect(channels[1]!.max).toBeGreaterThan(150); // #7c3aed has 58 green
  });

  it('stop sharing, expiry, a break or a suspension: the same "not valid" as a wrong link', async () => {
    const make = async () => (await share(mom)).json();
    const wrong = await get('/v1/resume/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(wrong.statusCode).toBe(404);
    const message = wrong.json().error.message;
    const expectGone = async (token: string) => {
      const res = await get(`/v1/resume/${token}`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toBe(message);
      expect((await get(`/v1/resume/${token}/photo`)).statusCode).toBe(404);
    };
    const ended = await make();
    expect((await api(ctx, dan, 'DELETE', `/v1/me/resume-links/${ended.id}`)).statusCode).toBe(404); // only the owner
    expect((await api(ctx, noa, 'DELETE', `/v1/me/resume-links/${ended.id}`)).statusCode).toBe(200);
    await expectGone(ended.token);
    const expired = await make();
    ctx.clock.value += 3 * 86_400_000 + 1000;
    await expectGone(expired.token);
    const paused = await make();
    await api(ctx, noa, 'PUT', '/v1/me/pause', { duration: 'indefinite' });
    await expectGone(paused.token);
    await api(ctx, noa, 'DELETE', '/v1/me/pause');
    expect((await get(`/v1/resume/${paused.token}`)).statusCode).toBe(200);
    await q(`UPDATE "user" SET status = 'suspended' WHERE id = $1`, [noa.id]);
    await expectGone(paused.token);
  });

  it(`up to ${MAX_RESUME_LINKS} at a time; plain-text labels; known lengths only`, async () => {
    for (let i = 0; i < MAX_RESUME_LINKS; i += 1) {
      expect((await share({ ...mom, label: `Person ${i}` })).statusCode).toBe(200);
    }
    expect((await share(mom)).statusCode).toBe(409);
    expect((await share({ ...mom, label: '<b>Mom</b>' })).statusCode).toBe(400);
    expect((await share({ ...mom, days: 30 })).statusCode).toBe(400);
    expect((await share({ ...mom, sections: ['email'] })).statusCode).toBe(400);
  });

  it('in "Download my data", without the token', async () => {
    const { token } = (await share(mom)).json();
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const text = strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!);
    expect(JSON.parse(text).resumeLinks).toEqual([
      expect.objectContaining({ label: 'Mom', sections: ['photo', 'prompts'] }),
    ]);
    expect(text).not.toContain(token);
  });
});
