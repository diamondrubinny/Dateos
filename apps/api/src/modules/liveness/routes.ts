// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  livenessCallbackSchema,
  livenessStartSchema,
  livenessStateSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { LivenessService } from './service.js';

const ok = z.object({ ok: z.literal(true) });

/** Phase 69: the member's side, the provider's photo fetch and signed callback, asking to verify. */
export const livenessRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  liveness: LivenessService;
}> = async (app, { auth, liveness }) => {
  app.register(async (member) => {
    member.addHook('preHandler', requireUser(auth));
    member.get(
      '/v1/me/liveness',
      { schema: { response: { 200: livenessStateSchema } } },
      async (request) => liveness.state(currentUser(request).id),
    );
    member.post(
      '/v1/me/liveness',
      {
        schema: { response: { 200: livenessStartSchema } },
        config: perUserLimit(10, 60 * 60 * 1000),
      },
      async (request) => liveness.start(currentUser(request).id),
    );
  });

  app.post(
    '/v1/matches/:id/verify-request',
    {
      preHandler: requireUser(auth),
      schema: { params: z.object({ id: z.uuid() }), response: { 200: ok } },
      config: perUserLimit(30, 60 * 60 * 1000),
    },
    async (request) => {
      await liveness.ask(request.params.id, currentUser(request).id);
      return { ok: true as const };
    },
  );

  // The provider (no session): one fetch of the photo to compare, then the signed result.
  app.get(
    '/v1/liveness/sessions/:id/photo',
    {
      schema: { params: z.object({ id: z.uuid() }) },
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const object = await liveness.photo(request.params.id);
      return reply
        .type('image/webp')
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .send(object.body);
    },
  );
  app.post(
    '/v1/liveness/callback',
    {
      schema: {
        body: livenessCallbackSchema,
        headers: z.object({ 'x-nexaheart-signature': z.string().max(128) }).loose(),
        response: { 200: ok },
      },
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request) => {
      await liveness.receive(request.body, request.headers['x-nexaheart-signature']);
      return { ok: true as const };
    },
  );
};
