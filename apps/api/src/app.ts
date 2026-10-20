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
import { authRoutes } from './auth/routes.js';
import { instanceRoutes } from './modules/instance/routes.js';
import { meRoutes } from './modules/me/routes.js';
import { photoRoutes } from './modules/photos/routes.js';
import type { Services } from './services.js';

export interface AppDependencies {
  /** Checked by /ready and closed on shutdown. */
  dependencies: Dependency[];
  redis?: Redis;
  /** Product features; omitted in health-only unit tests. */
  services?: Services;
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
  const typed = app.withTypeProvider<ZodTypeProvider>();
  await typed.register(healthRoutes, { dependencies: deps.dependencies });
  await typed.register(instanceRoutes, { env });

  const { services } = deps;
  if (services) {
    await app.register(authRoutes, { auth: services.auth, origin: env.PUBLIC_API_URL });
    await typed.register(meRoutes, { auth: services.auth, me: services.me });
    await typed.register(photoRoutes, { auth: services.auth, photos: services.photos });
  }

  app.addHook('onClose', async () => {
    await Promise.allSettled(deps.dependencies.map((dep) => dep.close()));
  });

  return app;
}
