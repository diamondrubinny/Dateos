import { callJoinSchema, callSchema, ErrorCode, startCallSchema } from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';
import type { CallService } from './service.js';

const params = z.object({ id: z.uuid() });

/** Video and voice dates for members (phase 15). */
export const callRoutes: FastifyPluginAsyncZod<{ auth: Auth; calls: CallService }> = async (
  app,
  { auth, calls },
) => {
  app.addHook('preHandler', requireUser(auth));

  app.post(
    '/v1/matches/:id/calls',
    {
      config: perUserLimit(20, 60 * 60_000),
      schema: { params, body: startCallSchema, response: { 201: callSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await calls.start(request.params.id, currentUser(request).id, request.body)),
  );

  const limit = perUserLimit(120, 60 * 60_000);
  app.get('/v1/calls/:id', { schema: { params, response: { 200: callSchema } } }, async (request) =>
    calls.get(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/calls/:id/join',
    { config: limit, schema: { params, response: { 200: callJoinSchema } } },
    async (request) => calls.join(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/calls/:id/decline',
    { config: limit, schema: { params, response: { 200: callSchema } } },
    async (request) => calls.decline(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/calls/:id/end',
    { config: limit, schema: { params, response: { 200: callSchema } } },
    async (request) => calls.end(request.params.id, currentUser(request).id),
  );
};

/**
 * LiveKit's webhooks (participant joined or left, room finished). No session: each request is
 * authenticated by LiveKit's signature over the exact body, so the body is kept as a string.
 */
export const callWebhookRoutes: FastifyPluginAsyncZod<{ calls: CallService }> = async (
  app,
  { calls },
) => {
  app.addContentTypeParser(
    'application/webhook+json',
    { parseAs: 'string', bodyLimit: 64 * 1024 },
    (_request, body, done) => done(null, body),
  );
  app.post(
    '/v1/livekit/webhook',
    { config: { rateLimit: { max: 600, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = typeof request.body === 'string' ? request.body : '';
      if (!(await calls.webhook(body, request.headers.authorization))) {
        throw new HttpError(401, ErrorCode.Unauthorized, 'Invalid signature.');
      }
      return reply.status(200).send({ ok: true });
    },
  );
};
