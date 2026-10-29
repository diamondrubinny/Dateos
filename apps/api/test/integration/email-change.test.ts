// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { EMAIL_CHANGE_MINUTES } from '@nexaheart/shared';
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

describe.skipIf(!integrationEnabled)('changing the account email (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let noaEmail: string;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    noaEmail = (await api(ctx, noa, 'GET', '/v1/me')).json().user.email;
    ctx.mail.length = 0;
  });

  const request = (m: Member, email: string) => api(ctx, m, 'POST', '/v1/me/email', { email });
  const confirm = (cookie: string, token: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/me/email/confirm',
      headers: { cookie },
      payload: { token },
    });
  /** The token from the confirmation email sent to `to`. */
  const tokenFor = (to: string) => {
    const mail = ctx.mail.find((m) => m.to === to && /confirm-email\?token=/.test(m.text));
    return mail ? /token=([\w-]+)/.exec(mail.text)![1]! : null;
  };

  it('confirms through the new mailbox, tells the old one, signs other devices out', async () => {
    const otherDevice = await signIn(ctx, noaEmail);
    expect((await request(noa, 'Noa.New@Example.test')).statusCode).toBe(202);

    const token = tokenFor('noa.new@example.test');
    expect(token).toBeTruthy();
    const notice = ctx.mail.find((m) => m.to === noaEmail && m.subject.includes('Email change'));
    expect(notice?.subject).toContain('Email change requested');
    expect(notice?.text).not.toMatch(/https?:\/\/\S+token/);
    // Only a hash is stored.
    const { rows } = await q('SELECT token_hash FROM email_changes');
    expect(rows[0].token_hash).not.toBe(token);

    const res = await confirm(noa.cookie, token!);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'noa.new@example.test' });
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().user.email).toBe('noa.new@example.test');
    // The other device is signed out; this one isn't.
    const other = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: otherDevice },
    });
    expect(other.statusCode).toBe(401);
    // One use only.
    expect((await confirm(noa.cookie, token!)).statusCode).toBe(404);
    // Account activity shows it; the audit log never holds the addresses.
    const activity = (await api(ctx, noa, 'GET', '/v1/me/activity')).json().events;
    expect(activity.map((e: { kind: string }) => e.kind)).toContain('email_changed');
    const logged = await q(`SELECT meta::text FROM audit_logs WHERE action LIKE 'email.%'`);
    expect(JSON.stringify(logged.rows)).not.toContain('example.test');
  });

  it('answers the same for a taken or banned address, and sends no link', async () => {
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    const danEmail = (await api(ctx, dan, 'GET', '/v1/me')).json().user.email;
    const taken = await request(noa, danEmail);
    const free = await request(noa, 'someone.free@example.test');
    expect(taken.statusCode).toBe(free.statusCode);
    expect(taken.json()).toEqual(free.json());
    expect(tokenFor(danEmail)).toBeNull();
    expect(tokenFor('someone.free@example.test')).toBeTruthy();
  });

  it('only in the same account, and only within 30 minutes', async () => {
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await request(noa, 'noa.two@example.test');
    const token = tokenFor('noa.two@example.test')!;
    // Dan can't use Noa's link, and a signed-out visitor can't either.
    expect((await confirm(dan.cookie, token)).statusCode).toBe(404);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/me/email/confirm',
          payload: { token },
        })
      ).statusCode,
    ).toBe(401);
    ctx.clock.value += (EMAIL_CHANGE_MINUTES + 1) * 60_000;
    expect((await confirm(noa.cookie, token)).statusCode).toBe(404);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().user.email).toBe(noaEmail);
  });

  it('a newer request replaces the older link; an address taken meanwhile is refused', async () => {
    await request(noa, 'first@example.test');
    const first = tokenFor('first@example.test')!;
    await request(noa, 'second@example.test');
    const second = tokenFor('second@example.test')!;
    expect((await confirm(noa.cookie, first)).statusCode).toBe(404);
    // Someone else signs up with that address before Noa confirms.
    await signIn(ctx, 'second@example.test');
    expect((await confirm(noa.cookie, second)).statusCode).toBe(409);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().user.email).toBe(noaEmail);
  });

  it('is rate-limited', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await request(noa, `try${i}@example.test`)).statusCode).toBe(202);
    }
    expect((await request(noa, 'try9@example.test')).statusCode).toBe(429);
  });
});
