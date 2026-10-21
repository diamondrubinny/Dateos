import { mediaKey } from '@dateos/storage';
import sharp from 'sharp';
import type { TestContext } from './setup.js';
import { signIn } from './setup.js';

export const places = {
  telAviv: { lat: 32.0853, lng: 34.7818 },
  ramatGan: { lat: 32.0684, lng: 34.8248 }, // ~4 km from Tel Aviv
  haifa: { lat: 32.794, lng: 34.9896 }, // ~80 km from Tel Aviv
};

export interface MemberOptions {
  name: string;
  gender: 'woman' | 'man' | 'nonbinary' | 'other';
  interestedIn: string[];
  birthDate?: string;
  intention?: string;
  at?: { lat: number; lng: number };
  prefs?: { ageMin: number; ageMax: number; maxDistanceKm: number; intentions?: string[] };
  bio?: string;
}

export interface Member {
  id: string;
  cookie: string;
  name: string;
  photoId: string;
  promptId: string;
}

let counter = 0;

/** A fully onboarded member with a clean photo, a prompt and a location. */
export async function createMember(ctx: TestContext, o: MemberOptions): Promise<Member> {
  counter += 1;
  const cookie = await signIn(ctx, `${o.name.toLowerCase()}-${counter}@example.test`);
  const send = (method: 'POST' | 'PUT', url: string, payload: unknown) =>
    ctx.app.inject({ method, url, headers: { cookie }, payload: payload as object });

  const profile = await send('POST', '/v1/me/profile', {
    displayName: o.name,
    birthDate: o.birthDate ?? '1995-01-01',
    gender: o.gender,
    interestedIn: o.interestedIn,
    intention: o.intention ?? 'long_term',
    bio: o.bio ?? `Hi, I am ${o.name}`,
    languages: ['he', 'en'],
  });
  if (profile.statusCode !== 201) throw new Error(`profile: ${profile.body}`);
  if (o.prefs) {
    await send('PUT', '/v1/me/preferences', { intentions: [], ...o.prefs });
  } else {
    await send('PUT', '/v1/me/preferences', {
      ageMin: 18,
      ageMax: 99,
      maxDistanceKm: 50,
      intentions: [],
    });
  }
  await send('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: ctx.env.TERMS_VERSION },
      { kind: 'privacy', granted: true, version: ctx.env.PRIVACY_VERSION },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  const at = o.at ?? places.telAviv;
  const loc = await send('PUT', '/v1/me/location', at);
  if (loc.statusCode !== 200) throw new Error(`location: ${loc.body}`);
  await send('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'green_flag', answer: `${o.name} likes kindness` }],
  });

  const me = (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json();
  const pool = ctx.services.dbHandle.pool;
  const { rows } = await pool.query(
    `INSERT INTO photos (user_id, status, position, width, height) VALUES ($1, 'clean', 0, 64, 64) RETURNING id`,
    [me.user.id],
  );
  const photoId = rows[0].id as string;
  const key = mediaKey(me.user.id, photoId);
  await pool.query('UPDATE photos SET media_key = $2 WHERE id = $1', [photoId, key]);
  const webp = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#7c3aed' },
  })
    .webp()
    .toBuffer();
  await ctx.services.storage.put(ctx.services.storage.buckets.media, key, webp, 'image/webp');
  const prompt = await pool.query('SELECT id FROM prompts WHERE user_id = $1', [me.user.id]);
  return { id: me.user.id, cookie, name: o.name, photoId, promptId: prompt.rows[0].id };
}

export async function api(
  ctx: TestContext,
  member: Member,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return ctx.app.inject({
    method,
    url,
    headers: { cookie: member.cookie },
    ...(payload ? { payload: payload as object } : {}),
  });
}

export async function discoverIds(ctx: TestContext, member: Member): Promise<string[]> {
  const res = await api(ctx, member, 'GET', '/v1/discover?limit=20');
  if (res.statusCode !== 200) throw new Error(`discover: ${res.body}`);
  return res.json().profiles.map((p: { id: string }) => p.id);
}
