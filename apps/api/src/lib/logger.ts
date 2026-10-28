// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import type { Env } from '../config/env.js';

/** Paths that must never reach the logs (credentials, tokens, contact details). */
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.code',
  '*.email',
  '*.phone',
  '*.lat',
  '*.text',
  '*.body',
  '*.lng',
];

/**
 * Logged requests keep the path only, never the query string (phase 32): it can carry a sign-in
 * token (`/magic-link/verify?token=…`) or what someone searched for in a chat.
 */
export function logUrl(url: string | undefined): string {
  return (url ?? '').split('?')[0]!;
}

export function buildLoggerOptions(
  env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>,
): Exclude<FastifyServerOptions['logger'], undefined> {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: logUrl(req.url),
        host: req.hostname,
      }),
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}
