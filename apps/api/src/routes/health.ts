import { healthResponseSchema, readinessResponseSchema } from '@dateos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Dependency } from '../lib/dependencies.js';

export interface HealthRoutesOptions {
  dependencies: Dependency[];
}

export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (
  app,
  { dependencies },
) => {
  // Liveness: the process is up. Never touches dependencies.
  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
    status: 'ok' as const,
  }));

  // Readiness: safe to route traffic here. Reports only up/down, no connection details.
  app.get(
    '/ready',
    { schema: { response: { 200: readinessResponseSchema, 503: readinessResponseSchema } } },
    async (_request, reply) => {
      const results = await Promise.all(
        dependencies.map(
          async (dep) => [dep.name, (await dep.isHealthy()) ? 'up' : 'down'] as const,
        ),
      );
      const checks = Object.fromEntries(results);
      const ready = results.every(([, status]) => status === 'up');
      return reply
        .status(ready ? 200 : 503)
        .send({ status: ready ? ('ready' as const) : ('not_ready' as const), checks });
    },
  );
};
