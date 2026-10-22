// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { FastifyServerOptions } from 'fastify';
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

export function buildLoggerOptions(
  env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>,
): Exclude<FastifyServerOptions['logger'], undefined> {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}
