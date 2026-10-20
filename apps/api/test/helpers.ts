import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv, type Env } from '../src/config/env.js';
import type { Dependency } from '../src/lib/dependencies.js';

export const baseEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://dateos:secret@localhost:5432/dateos',
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
