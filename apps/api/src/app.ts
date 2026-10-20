import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { Env } from './config/env.js';
import type { Dependency } from './lib/dependencies.js';
import { buildLoggerOptions } from './lib/logger.js';
import { registerErrorHandling } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';

export interface AppDependencies {
  /** Checked by /ready and closed on shutdown. */
  dependencies: Dependency[];
  redis?: Redis;
}

export async function buildApp(env: Env, deps: AppDependencies): Promise<FastifyInstance> {
  const quietUrls = new Set(['/health', '/ready']);
  const app = Fastify({
    logger: buildLoggerOptions(env),
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    // Request ids are always generated server-side so clients cannot forge log correlation.
    genReqId: () => randomUUID(),
    logController: new LogController({
      requestIdLogLabel: 'requestId',
      // Probes would flood the logs; tests stay silent.
      disableRequestLogging: (request) => env.NODE_ENV === 'test' || quietUrls.has(request.url),
    }),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);
  await registerSecurity(app, { env, ...(deps.redis ? { redis: deps.redis } : {}) });
  await app.withTypeProvider<ZodTypeProvider>().register(healthRoutes, {
    dependencies: deps.dependencies,
  });

  app.addHook('onClose', async () => {
    await Promise.allSettled(deps.dependencies.map((dep) => dep.close()));
  });

  return app;
}
