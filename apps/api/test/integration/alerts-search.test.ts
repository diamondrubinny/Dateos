// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { chatSearchResultSchema } from '@nexaheart/shared';
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

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ANDROID = 'okhttp/4.12.0';

describe.skipIf(!integrationEnabled)('sign-in alerts and chat search (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  describe('an email when a new kind of device signs in', () => {
    const alerts = (email: string) =>
      ctx.mail.filter((m) => m.to === email && m.subject.includes('New sign-in'));
    const settle = () => new Promise((r) => setTimeout(r, 100));

    it('not on the first sign-in, not for a known device, yes for a new one, with no link', async () => {
      await signIn(ctx, 'noa@example.test', { userAgent: FIREFOX });
      await settle();
      expect(alerts('noa@example.test')).toHaveLength(0); // the first sign-in
      await signIn(ctx, 'noa@example.test', { userAgent: FIREFOX });
      await settle();
      expect(alerts('noa@example.test')).toHaveLength(0); // the same kind of device
      await signIn(ctx, 'noa@example.test', { userAgent: ANDROID });
      await settle();
      const [mail] = alerts('noa@example.test');
      expect(mail).toBeDefined();
      expect(mail!.text).toContain('NexaHeart app on Android');
      expect(mail!.text).toContain('האפליקציה · Android');
      // No link at all, so it can't be imitated for phishing.
      expect(mail!.text).not.toMatch(/https?:\/\//);
      expect(mail!.html).not.toContain('<a ');
    });

    it('can be turned off, and is limited to 3 a day', async () => {
      const first = await signIn(ctx, 'dan@example.test', { userAgent: FIREFOX });
      const agents = [
        ANDROID,
        CHROME_WIN,
        'NexaHeart/1 CFNetwork/1568 Darwin/24.0.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      ];
      // Four new kinds of device (the sign-in limit allows five links an hour per address).
      for (const ua of agents) await signIn(ctx, 'dan@example.test', { userAgent: ua });
      await settle();
      expect(alerts('dan@example.test')).toHaveLength(3);
      expect(first).toBeTruthy();
    });

    it('stays off when the member says so', async () => {
      const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      expect(
        (await api(ctx, noa, 'PUT', '/v1/me/settings', { signinAlerts: false })).statusCode,
      ).toBe(200);
      expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().signinAlerts).toBe(false);
      const email = (await api(ctx, noa, 'GET', '/v1/me')).json().user.email as string;
      await signIn(ctx, email, { userAgent: ANDROID });
      await signIn(ctx, email, { userAgent: CHROME_WIN });
      await settle();
      expect(alerts(email)).toHaveLength(0);
    });
  });

  describe('search in a chat', () => {
    let noa: Member;
    let dan: Member;
    let matchId: string;
    let n = 0;
    beforeEach(async () => {
      noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
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
    const search = async (m: Member, q: string, id = matchId) =>
      api(ctx, m, 'GET', `/v1/matches/${id}/messages/search?q=${encodeURIComponent(q)}`);

    it('finds text, case-insensitive, newest first, never unsent or hidden-from-me', async () => {
      await send(dan, 'The Cafe on Dizengoff opens at 8');
      await send(noa, 'Let’s meet at the cafe then');
      const oops = await send(noa, 'cafe secret plan');
      await api(ctx, noa, 'DELETE', `/v1/matches/${matchId}/messages/${oops}`);
      await send(dan, 'send nudes at the cafe'); // harmful: hidden from Noa
      const res = chatSearchResultSchema.parse((await search(noa, 'CAFE')).json());
      expect(res.results.map((r) => r.body)).toEqual([
        'Let’s meet at the cafe then',
        'The Cafe on Dizengoff opens at 8',
      ]);
      expect(res.results.map((r) => r.mine)).toEqual([true, false]);
      // The sender still finds their own harmful message.
      const forDan = chatSearchResultSchema.parse((await search(dan, 'nudes')).json());
      expect(forDan.results).toHaveLength(1);
    });

    it('treats % and _ literally, and checks the chat and the length', async () => {
      await send(noa, '100% sure');
      await send(noa, 'nothing here');
      const literal = chatSearchResultSchema.parse((await search(noa, '0%')).json());
      expect(literal.results.map((r) => r.body)).toEqual(['100% sure']);
      expect(chatSearchResultSchema.parse((await search(noa, '__')).json()).results).toEqual([]);
      expect((await search(noa, 'a')).statusCode).toBe(400);
      const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
      expect((await search(eve, 'sure')).statusCode).toBe(404);
    });
  });
});
