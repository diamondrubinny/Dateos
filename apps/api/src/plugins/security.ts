import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

export interface SecurityOptions {
  env: Env;
  /** Shared rate-limit store; falls back to in-memory (single instance only) when absent. */
  redis?: Redis;
}

export async function registerSecurity(app: FastifyInstance, { env, redis }: SecurityOptions) {
  // A JSON API serves no documents, so the strictest policy applies.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    ...(redis ? { redis, nameSpace: 'dateos:rl:' } : {}),
    // The global limiter fails open so a Redis blip does not take the whole API down (/ready
    // reports the outage). Sensitive routes such as auth override this to fail closed.
    skipOnError: true,
    allowList: (request) => request.url === '/health',
  });
}
