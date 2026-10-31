// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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
import { instanceRoutes, setupRoutes } from './modules/instance/routes.js';
import websocket from '@fastify/websocket';
import { chatRoutes } from './modules/chat/routes.js';
import { checkinRoutes } from './modules/checkins/routes.js';
import { dateRoutes } from './modules/dates/routes.js';
import { eventRoutes } from './modules/events/routes.js';
import { speedRoutes } from './modules/speed/routes.js';
import { travelRoutes } from './modules/places/routes.js';
import { callRoutes, callWebhookRoutes } from './modules/calls/routes.js';
import { discoveryRoutes } from './modules/discovery/routes.js';
import { meRoutes } from './modules/me/routes.js';
import { ageCheckRoutes } from './modules/age-check/routes.js';
import { livenessRoutes } from './modules/liveness/routes.js';
import { exportMemberData } from './modules/privacy/export.js';
import { audit } from './lib/audit.js';
import { photoRoutes } from './modules/photos/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { federatedRoutes } from './modules/federation/member-routes.js';
import { federationRoutes } from './modules/federation/routes.js';
import { safetyRoutes } from './modules/safety/routes.js';
import { deviceRoutes } from './modules/devices/routes.js';
import { accountRoutes } from './modules/account/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { coachRoutes } from './modules/coach/routes.js';
import { matchmakerRoutes } from './modules/matchmaker/routes.js';
import { introductionRoutes } from './modules/introductions/routes.js';
import { resumePublicRoutes, resumeRoutes } from './modules/resume/routes.js';
import { chaperoneRoutes } from './modules/chaperone/routes.js';
import { signupRoutes, trustRoutes } from './modules/trust/routes.js';
import { friendRoutes, takePublicRoutes } from './modules/friends/routes.js';
import { clientErrorRoutes, registerCaptcha } from './modules/integrations/routes.js';
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

  registerErrorHandling(app, (error, request) => {
    // The route pattern and method only: never the URL with its ids, the body or the user.
    void deps.services?.integrations.captureError(
      { type: error.name, message: error.message, stack: error.stack },
      'node',
      { route: request.routeOptions.url ?? 'unknown', method: request.method },
    );
  });
  await registerSecurity(app, { env, ...(deps.redis ? { redis: deps.redis } : {}) });
  const typed = app.withTypeProvider<ZodTypeProvider>();
  await typed.register(healthRoutes, { dependencies: deps.dependencies });
  await typed.register(instanceRoutes, {
    env,
    ...(deps.services
      ? { instance: deps.services.instance, integrations: deps.services.integrations }
      : {}),
  });

  const { services } = deps;
  if (services) {
    // Bot protection (phase 24) before any route, including better-auth's.
    registerCaptcha(app, services.integrations);
    await typed.register(clientErrorRoutes, { integrations: services.integrations });
    await app.register(authRoutes, {
      auth: services.auth,
      origin: env.PUBLIC_API_URL,
      redis: services.redis,
      appScheme: env.APP_SCHEME,
    });
    // Phase 63: age assurance (the member's side and the provider's signed callback).
    await typed.register(ageCheckRoutes, { auth: services.auth, ageCheck: services.ageCheck });
    await typed.register(livenessRoutes, { auth: services.auth, liveness: services.liveness });
    await typed.register(meRoutes, {
      auth: services.auth,
      me: services.me,
      appeals: services.appeals,
      exportData: async (userId) => {
        const zip = await exportMemberData(services.dbHandle.db, services.storage, userId);
        await audit(services.dbHandle.db, {
          actorId: userId,
          action: 'account.exported',
          targetType: 'user',
          targetId: userId,
        });
        return zip;
      },
    });
    await typed.register(photoRoutes, {
      auth: services.auth,
      photos: services.photos,
      album: services.album,
    });
    await typed.register(discoveryRoutes, { auth: services.auth, discovery: services.discovery });
    await typed.register(safetyRoutes, {
      auth: services.auth,
      reports: services.reports,
      verification: services.verification,
      onReported: (reporterId, targetId) => services.calls.endBetween(reporterId, targetId),
    });
    await typed.register(adminRoutes, {
      auth: services.auth,
      mfa: services.staffMfa,
      moderation: services.moderation,
      verification: services.verification,
      photos: services.photos,
      instance: services.instance,
      storage: services.storage,
      venues: services.venues,
      events: services.events,
      trust: services.trust,
      integrations: services.integrations,
      federation: services.federation,
      updates: services.updates,
      dependencies: deps.dependencies,
      appeals: services.appeals,
      compliance: services.compliance,
      introductions: services.introductions,
      profileReview: services.profileReview,
      organizers: services.organizers,
    });
    await typed.register(chaperoneRoutes, { auth: services.auth, chaperones: services.chaperones });
    await typed.register(resumePublicRoutes, { resume: services.resume });
    await typed.register(resumeRoutes, { auth: services.auth, resume: services.resume });
    await typed.register(introductionRoutes, {
      auth: services.auth,
      introductions: services.introductions,
    });
    await typed.register(federationRoutes, {
      federation: services.federation,
      members: services.federated,
      chat: services.federatedChat,
      safety: services.federatedSafety,
      signals: services.federatedSignals,
    });
    await typed.register(federatedRoutes, {
      auth: services.auth,
      members: services.federated,
      chat: services.federatedChat,
      safety: services.federatedSafety,
    });
    await typed.register(signupRoutes, { trust: services.trust });
    await typed.register(takePublicRoutes, { takes: services.takes });
    await typed.register(friendRoutes, {
      auth: services.auth,
      takes: services.takes,
      pairs: services.pairs,
    });
    await typed.register(trustRoutes, { auth: services.auth, trust: services.trust });
    await typed.register(coachRoutes, {
      auth: services.auth,
      db: services.dbHandle.db,
      ai: services.ai,
    });
    await typed.register(matchmakerRoutes, {
      auth: services.auth,
      me: services.me,
      ai: services.ai,
    });
    await typed.register(checkinRoutes, { auth: services.auth, checkins: services.checkins });
    await typed.register(dateRoutes, {
      auth: services.auth,
      dates: services.dates,
      venues: services.venues,
    });
    await typed.register(eventRoutes, {
      auth: services.auth,
      events: services.events,
      meetAgain: services.meetAgain,
      tables: services.tables,
      organizers: services.organizers,
    });
    await typed.register(speedRoutes, { auth: services.auth, speed: services.speed });
    await typed.register(travelRoutes, {
      auth: services.auth,
      cities: services.cities,
      travel: services.travel,
    });
    await typed.register(callRoutes, { auth: services.auth, calls: services.calls });
    await typed.register(callWebhookRoutes, { calls: services.calls });
    await typed.register(notificationRoutes, {
      auth: services.auth,
      db: services.dbHandle.db,
      webPush: Boolean(env.WEB_PUSH_PUBLIC_KEY),
    });
    await typed.register(deviceRoutes, { auth: services.auth, db: services.dbHandle.db });
    await typed.register(accountRoutes, { auth: services.auth, emailChange: services.emailChange });
    await typed.register(setupRoutes, { auth: services.auth, instance: services.instance });
    await app.register(websocket, { options: { maxPayload: 4096 } });
    await typed.register(chatRoutes, {
      auth: services.auth,
      chat: services.chat,
      realtime: services.realtime,
      allowedOrigins: env.CORS_ORIGINS,
      heartbeatMs: env.WS_HEARTBEAT_MS,
      audio: services.audio,
      album: services.album,
    });
  }

  app.addHook('onClose', async () => {
    await Promise.allSettled(deps.dependencies.map((dep) => dep.close()));
  });

  return app;
}
