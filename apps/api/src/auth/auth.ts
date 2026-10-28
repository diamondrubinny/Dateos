// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash } from 'node:crypto';
import { expo } from '@better-auth/expo';
import { passkey } from '@better-auth/passkey';
import { schema, type Database } from '@nexaheart/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { Redis } from 'ioredis';
import { appUrl, type Env } from '../config/env.js';
import { createEmailHasher, isBanned } from '../lib/banned.js';
import { audit } from '../lib/audit.js';
import { deviceLabel } from '../lib/device-label.js';
import { maybeAlertNewDevice } from '../lib/signin-alert.js';
import { magicLinkEmail, type Mailer } from '../lib/mailer.js';
import type { TrustService } from '../modules/trust/service.js';

export const AUTH_BASE_PATH = '/v1/auth';
/** Header the API sets from Fastify's verified client IP; client-supplied values are dropped. */
export const CLIENT_IP_HEADER = 'x-nexaheart-client-ip';

const MAGIC_LINK_TTL_SECONDS = 10 * 60;
/**
 * Sign-in emails per address. Counted per address *and* sender IP, so one attacker can't lock
 * someone out by spending their quota; the per-address total still protects an inbox from floods
 * coming from many IPs.
 */
const MAX_LINKS_PER_EMAIL_AND_IP_PER_HOUR = 5;
const MAX_LINKS_PER_EMAIL_PER_HOUR = 20;

async function allowEmail(redis: Redis, email: string, ip: string): Promise<boolean> {
  const hash = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const counts: number[] = [];
  for (const key of [`nexaheart:ml:${hash}`, `nexaheart:ml:${hash}:${ipHash}`]) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3_600);
    counts.push(count);
  }
  return (
    counts[0]! <= MAX_LINKS_PER_EMAIL_PER_HOUR && counts[1]! <= MAX_LINKS_PER_EMAIL_AND_IP_PER_HOUR
  );
}

export interface AuthDeps {
  env: Env;
  secret: string;
  db: Database;
  redis: Redis;
  mailer: Mailer;
  onMailError: (error: unknown) => void;
  /** Who may open a new account (phase 21); without it, sign-up is open. */
  signup?: Pick<
    TrustService,
    'mayCreateAccount' | 'consumeAllowance' | 'signInBlockedFor' | 'sendSignupClosed'
  >;
}

export function createAuth({ env, secret, db, redis, mailer, onMailError, signup }: AuthDeps) {
  const touchLastSeen = async (userId: string): Promise<void> => {
    await db
      .update(schema.user)
      .set({ lastSeenAt: new Date(), inactivityNoticeAt: null })
      .where(eq(schema.user.id, userId));
  };
  const socialProviders = {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
      ? { apple: { clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET } }
      : {}),
  };

  const hashEmail = createEmailHasher(secret);

  return betterAuth({
    appName: env.INSTANCE_NAME,
    baseURL: env.PUBLIC_API_URL,
    basePath: AUTH_BASE_PATH,
    secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
        passkey: schema.passkey,
      },
    }),
    trustedOrigins: [...env.CORS_ORIGINS, `${env.APP_SCHEME}://`],
    emailAndPassword: { enabled: false },
    socialProviders,
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'user', input: false },
        status: { type: 'string', defaultValue: 'active', input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Banned addresses cannot open a new account (with any sign-in method). The client
          // only sees a generic sign-in failure.
          // In invite or waitlist mode, only an address with a current permission (phase 21).
          before: async (data) =>
            (await isBanned(db, hashEmail, data.email)) ||
            (signup && !(await signup.mayCreateAccount(data.email)))
              ? false
              : undefined,
          after: async (data) => {
            await signup?.consumeAllowance(data.email);
          },
        },
      },
      // Sign-in activity for the optional inactivity rule. Sessions refresh at most daily (updateAge),
      // so this is a coarse "last seen" and never a tracking signal.
      session: {
        create: {
          // Data minimisation: the product never uses a session's IP address or browser string, so
          // they are not stored (rate limiting reads the request's IP and keeps it only briefly).
          // Only a coarse device label is kept, for "Your devices" (phase 29).
          before: async (s) => ({
            data: { ...s, deviceLabel: deviceLabel(s.userAgent), ipAddress: null, userAgent: null },
          }),
          after: async (s) => {
            await touchLastSeen(s.userId);
            // Account activity (phase 31): the sign-in, with the coarse device code only.
            const device = (s as typeof s & { deviceLabel?: string | null }).deviceLabel;
            await audit(db, {
              actorId: s.userId,
              action: 'session.created',
              targetType: 'user',
              targetId: s.userId,
              ...(device ? { meta: { device } } : {}),
            });
            // A new kind of device (phase 32): an email, never blocking the sign-in.
            if (device) {
              void maybeAlertNewDevice(
                { db, redis, mailer, instanceName: env.INSTANCE_NAME },
                s.userId,
                device,
              ).catch(onMailError);
            }
          },
        },
        update: { after: async (s) => (s.userId ? touchLastSeen(s.userId) : undefined) },
      },
    },
    session: {
      additionalFields: {
        deviceLabel: { type: 'string', required: false, input: false },
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/magic-link': { window: 600, max: 5 },
        '/magic-link/verify': { window: 600, max: 20 },
        '/passkey/verify-authentication': { window: 600, max: 20 },
        '/passkey/generate-authenticate-options': { window: 600, max: 40 },
      },
    },
    advanced: {
      cookiePrefix: 'nexaheart',
      useSecureCookies: env.PUBLIC_API_URL.startsWith('https://'),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        storeToken: 'hashed',
        async sendMagicLink({ email, url }, ctx) {
          // The HTTP response is identical whether or not mail is sent, so callers cannot
          // learn whether an address is registered or currently throttled.
          const ip = ctx?.request?.headers.get(CLIENT_IP_HEADER) ?? 'unknown';
          if (!(await allowEmail(redis, email, ip))) return;
          // A new address that may not join yet gets "how to join" instead of a link that fails.
          const blocked = await signup?.signInBlockedFor(email);
          if (blocked) return signup!.sendSignupClosed(email, blocked);
          mailer.send({ to: email, ...magicLinkEmail(env.INSTANCE_NAME, url) }).catch(onMailError);
        },
      }),
      expo(),
      // Passkeys (phase 21): the web app's domain is the relying party; public keys only are kept.
      passkey({
        rpID: new URL(appUrl(env)).hostname,
        rpName: env.INSTANCE_NAME,
        origin: [...new Set([appUrl(env), ...env.CORS_ORIGINS])],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
