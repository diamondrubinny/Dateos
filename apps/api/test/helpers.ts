// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv, type Env } from '../src/config/env.js';
import type { Dependency } from '../src/lib/dependencies.js';

export const baseEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://nexaheart:secret@localhost:5432/nexaheart',
  REDIS_URL: 'redis://localhost:6379',
} satisfies NodeJS.ProcessEnv;

export function fakeDependency(name: string, healthy = true): Dependency & { closed: boolean } {
  return {
    name,
    closed: false,
    isHealthy: async () => healthy,
    async close() {
      this.closed = true;
    },
  };
}

export async function buildTestApp(
  overrides: NodeJS.ProcessEnv = {},
  dependencies: Dependency[] = [fakeDependency('postgres'), fakeDependency('redis')],
): Promise<{ app: FastifyInstance; env: Env }> {
  const env = loadEnv({ ...baseEnv, ...overrides });
  const app = await buildApp(env, { dependencies });
  return { app, env };
}
