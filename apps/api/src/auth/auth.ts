import { createHash } from 'node:crypto';
import { expo } from '@better-auth/expo';
import { schema, type Database } from '@dateos/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { createEmailHasher, isBanned } from '../lib/banned.js';
import { magicLinkEmail, type Mailer } from '../lib/mailer.js';

export const AUTH_BASE_PATH = '/v1/auth';
/** Header the API sets from Fastify's verified client IP; client-supplied values are dropped. */
export const CLIENT_IP_HEADER = 'x-dateos-client-ip';

const MAGIC_LINK_TTL_SECONDS = 10 * 60;
/** Protects a single inbox from being flooded from many IPs. */
const MAX_LINKS_PER_EMAIL_PER_HOUR = 5;

export interface AuthDeps {
  env: Env;
  secret: string;
  db: Database;
  redis: Redis;
  mailer: Mailer;
  onMailError: (error: unknown) => void;
}

async function allowEmail(redis: Redis, email: string): Promise<boolean> {
  const key = `dateos:ml:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3_600);
  return count <= MAX_LINKS_PER_EMAIL_PER_HOUR;
}

export function createAuth({ env, secret, db, redis, mailer, onMailError }: AuthDeps) {
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
          before: async (data) => ((await isBanned(db, hashEmail, data.email)) ? false : undefined),
        },
      },
      // Sign-in activity for the optional inactivity rule. Sessions refresh at most daily (updateAge),
      // so this is a coarse "last seen" and never a tracking signal.
      session: {
        create: {
          // Data minimisation: the product never uses a session's IP address or browser string, so
          // they are not stored (rate limiting reads the request's IP and keeps it only briefly).
          before: async (s) => ({ data: { ...s, ipAddress: null, userAgent: null } }),
          after: async (s) => touchLastSeen(s.userId),
        },
        update: { after: async (s) => (s.userId ? touchLastSeen(s.userId) : undefined) },
      },
    },
    session: {
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
      },
    },
    advanced: {
      cookiePrefix: 'dateos',
      useSecureCookies: env.PUBLIC_API_URL.startsWith('https://'),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        storeToken: 'hashed',
        async sendMagicLink({ email, url }) {
          // The HTTP response is identical whether or not mail is sent, so callers cannot
          // learn whether an address is registered or currently throttled.
          if (!(await allowEmail(redis, email))) return;
          mailer.send({ to: email, ...magicLinkEmail(env.INSTANCE_NAME, url) }).catch(onMailError);
        },
      }),
      expo(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
