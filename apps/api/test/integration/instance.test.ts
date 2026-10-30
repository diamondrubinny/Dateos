// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const TOKEN = 'test-setup-token-0123456789abcdef';
const BOUNDARY = 'logoboundary';

async function logoBody(format: 'png' | 'svg' = 'png') {
  const file =
    format === 'svg'
      ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
      : await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0f766e' } })
          .png()
          .toBuffer();
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="logo.${format}"\r\nContent-Type: image/${format}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, file, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    type: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

describe.skipIf(!integrationEnabled)('instance setup & branding (integration)', () => {
  let ctx: TestContext;
  let noa: Member;

  beforeAll(async () => {
    process.env.SETUP_TOKEN = TOKEN;
    ctx = await setupIntegration();
  });
  afterAll(async () => {
    delete process.env.SETUP_TOKEN;
    await teardown(ctx);
  });
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
  });

  const instance = async () =>
    (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
  const claim = (cookie: string, token: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/setup/claim',
      headers: { cookie },
      payload: { token },
    });

  async function verifiedAdmin(cookie: string) {
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    ctx.clock.value += 30_000;
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    expect(ok.statusCode).toBe(200);
  }

  it('always returns the software credit, whatever the branding', async () => {
    expect((await instance()).poweredBy).toEqual({
      name: 'NexaHeart',
      url: 'https://nexaheart.com',
      license: 'AGPL-3.0-or-later',
      sourceUrl: 'https://github.com/diamondrubinny/Dateos',
      author: { name: 'Diamond Rubinny', url: 'https://github.com/diamondrubinny' },
    });
  });

  it('lets the token holder claim a fresh instance exactly once', async () => {
    expect((await instance()).setupRequired).toBe(true);
    const owner = await signIn(ctx, 'owner@example.test');

    const wrong = await claim(owner, 'not-the-right-token-123456');
    expect(wrong.statusCode).toBe(403);
    expect((await claim(owner, TOKEN)).statusCode).toBe(200);
    expect((await instance()).setupRequired).toBe(false);
    // The new admin still has to set up TOTP before using the dashboard.
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/v1/admin/reports',
          headers: { cookie: owner },
        })
      ).json().error.code,
    ).toBe('MFA_REQUIRED');

    // A second claim (even with the right token) is refused for good.
    const late = await claim(noa.cookie, TOKEN);
    expect(late.statusCode).toBe(410);
    const role = await ctx.services.dbHandle.pool.query('SELECT role FROM "user" WHERE id = $1', [
      noa.id,
    ]);
    expect(role.rows[0].role).toBe('user');

    const log = await ctx.services.dbHandle.pool.query(
      `SELECT action FROM audit_logs WHERE action LIKE 'setup.%' ORDER BY created_at`,
    );
    expect(log.rows.map((r) => r.action)).toEqual(['setup.claim_failed', 'setup.claimed']);
  });

  it('the token never works again, even after the last admin leaves', async () => {
    const owner = await signIn(ctx, 'owner@example.test');
    expect((await claim(owner, TOKEN)).statusCode).toBe(200);
    // The only admin deletes their account: no admin is left.
    expect(
      (await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: { cookie: owner } }))
        .statusCode,
    ).toBe(200);
    expect((await instance()).setupRequired).toBe(false);
    expect((await claim(noa.cookie, TOKEN)).statusCode).toBe(410);
    const role = await ctx.services.dbHandle.pool.query('SELECT role FROM "user" WHERE id = $1', [
      noa.id,
    ]);
    expect(role.rows[0].role).toBe('user');
  });

  it('is closed once an admin exists from the CLI, and requires a session', async () => {
    await ctx.services.dbHandle.pool.query(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [
      noa.id,
    ]);
    ctx.services.instance.invalidate();
    expect((await instance()).setupRequired).toBe(false);
    const other = await signIn(ctx, 'other@example.test');
    expect((await claim(other, TOKEN)).statusCode).toBe(410);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/v1/setup/claim', payload: { token: TOKEN } }))
        .statusCode,
    ).toBe(401);
  });

  it('rate-limits token guessing per account', async () => {
    const guesser = await signIn(ctx, 'guesser@example.test');
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1)
      codes.push((await claim(guesser, `wrong-token-attempt-${i}-xxxxxx`)).statusCode);
    expect(codes.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
    expect(codes[5]).toBe(429);
  });

  it('applies validated branding for everyone; only admins with TOTP may change it', async () => {
    const owner = await signIn(ctx, 'owner@example.test');
    await claim(owner, TOKEN);
    const patch = (cookie: string, payload: object) =>
      ctx.app.inject({ method: 'PATCH', url: '/v1/admin/instance', headers: { cookie }, payload });

    expect((await patch(owner, { name: 'Ahava' })).json().error.code).toBe('MFA_REQUIRED');
    await verifiedAdmin(owner);
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/v1/admin/instance',
          headers: { cookie: owner },
        })
      ).json().setupCompleted,
    ).toBe(false);

    // Rejected: unreadable color, markup, non-https link, unknown field.
    expect((await patch(owner, { primaryColor: '#FDE047' })).statusCode).toBe(400);
    expect((await patch(owner, { name: '<b>Hi</b>' })).statusCode).toBe(400);
    expect((await patch(owner, { sponsorUrl: 'http://pay.example' })).statusCode).toBe(400);
    expect((await patch(owner, { role: 'x' })).statusCode).toBe(400);

    const res = await patch(owner, {
      name: 'Ahava TLV',
      tagline: 'Dating for Tel Aviv, run by volunteers.',
      primaryColor: '#0F766E',
      defaultLocale: 'he',
      operatorName: 'Ahava Community Association',
      contactEmail: 'hello@ahava.example',
      sponsorUrl: null,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().setupCompleted).toBe(true);
    const info = await instance();
    expect(info).toMatchObject({
      name: 'Ahava TLV',
      primaryColor: '#0F766E',
      operatorName: 'Ahava Community Association',
      contactEmail: 'hello@ahava.example',
      sponsorUrl: null,
    });
    expect(info.brand.light.primary).toBe('#0F766E');
    expect(info.brand.dark.primary).not.toBe('#0F766E'); // lightened for dark mode

    // Phase 57: the web app manifest follows the branding, in the default language's direction.
    const manifest = await ctx.app.inject({
      method: 'GET',
      url: '/v1/instance/manifest.webmanifest',
    });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['content-type']).toContain('application/manifest+json');
    expect(manifest.json()).toMatchObject({
      name: 'Ahava TLV',
      short_name: 'Ahava TLV',
      description: 'Dating for Tel Aviv, run by volunteers.',
      start_url: '/',
      display: 'standalone',
      lang: 'he',
      dir: 'rtl',
      theme_color: '#0F766E',
    });

    // A moderator (even with TOTP) cannot change branding.
    const modCookie = await signIn(ctx, 'mod@example.test');
    await ctx.services.dbHandle.pool.query(
      `UPDATE "user" SET role = 'moderator' WHERE email = 'mod@example.test'`,
    );
    await verifiedAdmin(modCookie);
    expect((await patch(modCookie, { name: 'Hijacked' })).statusCode).toBe(403);
    expect((await patch(noa.cookie, { name: 'Hijacked' })).statusCode).toBe(403);
    expect((await instance()).name).toBe('Ahava TLV');
  });

  it('runs the logo through the upload pipeline and serves it publicly once clean', async () => {
    const owner = await signIn(ctx, 'owner@example.test');
    await claim(owner, TOKEN);
    await verifiedAdmin(owner);
    const upload = async (format: 'png' | 'svg') => {
      const body = await logoBody(format);
      return ctx.app.inject({
        method: 'POST',
        url: '/v1/admin/instance/logo',
        headers: { cookie: owner, 'content-type': body.type },
        payload: body.payload,
      });
    };
    expect((await upload('svg')).statusCode).toBe(415); // no SVG (scripts)
    expect((await upload('png')).statusCode).toBe(202);
    const job = ctx.jobs.process.at(-1)!;
    expect((await instance()).logoUrl).toBeNull(); // not scanned yet
    // Phase 59: no clean logo yet: the installed app keeps the built-in icon.
    const noLogoIcon = await ctx.app.inject({
      method: 'GET',
      url: '/v1/instance/icons/icon-192.png',
    });
    expect(noLogoIcon.statusCode).toBe(302);
    expect(noLogoIcon.headers.location).toBe('/icons/icon-192.png');
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/v1/photos/${job.photoId}`,
          headers: { cookie: noa.cookie },
        })
      ).statusCode,
    ).toBe(404);

    // Simulate the worker finishing the scan + re-encode.
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT user_id FROM photos WHERE id = $1',
      [job.photoId],
    );
    const key = `photos/${rows[0].user_id}/${job.photoId}.webp`;
    await ctx.services.storage.put(
      ctx.services.storage.buckets.media,
      key,
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0f766e' } })
        .webp()
        .toBuffer(),
      'image/webp',
    );
    await ctx.services.dbHandle.pool.query(
      `UPDATE photos SET status = 'clean', media_key = $2 WHERE id = $1`,
      [job.photoId, key],
    );
    ctx.services.instance.invalidate();

    const info = await instance();
    expect(info.logoUrl).toMatch(/^\/v1\/instance\/logo\?v=/);
    const logo = await ctx.app.inject({ method: 'GET', url: info.logoUrl });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toBe('image/webp');

    // Phase 59: the installed app's icons are made from the logo, and the manifest points to them.
    const icon = async (name: string) => {
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/instance/icons/${name}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      const { data, info: meta } = await sharp(res.rawPayload)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => {
        const i = (y * meta.width + x) * meta.channels;
        return `#${[data[i], data[i + 1], data[i + 2]].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
      };
      return { width: meta.width, height: meta.height, at };
    };
    // The logo is WebP (lossy): its colour within a few steps of #0f766e.
    const teal = (hex: string) =>
      [0x0f, 0x76, 0x6e].every(
        (v, i) => Math.abs(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) - v) <= 4,
      );
    const any512 = await icon('icon-512.png');
    expect([any512.width, any512.height]).toEqual([512, 512]);
    expect(any512.at(5, 5)).toBe('#ffffff'); // a white margin
    expect(teal(any512.at(256, 256))).toBe(true); // the logo in the middle
    expect(teal(any512.at(60, 256))).toBe(true); // 80 %: the logo reaches 51 px from the edge
    const maskable = await icon('maskable-512.png');
    expect(maskable.at(60, 256)).toBe('#ffffff'); // 60 %: kept inside Android's safe zone
    expect(teal(maskable.at(256, 256))).toBe(true);
    expect((await icon('apple-touch-icon.png')).width).toBe(180);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/instance/icons/..%2Fsecret.png' }))
        .statusCode,
    ).toBe(400);
    const manifest = await ctx.app.inject({
      method: 'GET',
      url: '/v1/instance/manifest.webmanifest',
    });
    const version = info.logoUrl!.split('v=')[1];
    expect(manifest.json().icons.map((i: { src: string }) => i.src)).toEqual([
      `/brand-icons/icon-192.png?v=${version}`,
      `/brand-icons/icon-512.png?v=${version}`,
      `/brand-icons/maskable-512.png?v=${version}`,
    ]);

    // Replacing the logo purges the old file; removing it clears the URL.
    await upload('png');
    expect(ctx.jobs.delete.at(-1)?.mediaKeys).toEqual([key]);
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: '/v1/admin/instance/logo',
          headers: { cookie: owner },
        })
      ).statusCode,
    ).toBe(200);
    ctx.services.instance.invalidate();
    expect((await instance()).logoUrl).toBeNull();
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/instance/icons/icon-512.png' })).statusCode,
    ).toBe(302);
  });
});
