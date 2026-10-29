// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkinExtendSchema, checkinInputSchema, checkinSchema } from '@nexaheart/shared';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { CheckinService } from './service.js';

const params = z.object({ id: z.uuid() });
const ok = z.object({ ok: z.literal(true) });

/**
 * Safety check-ins. Owner-only. Viewing, "I'm OK" and SOS also work for a suspended account:
 * safety comes first. Creating a new check-in needs an active account.
 */
export const checkinRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  checkins: CheckinService;
}> = async (app, { auth, checkins }) => {
  // Creating: an active account. Auth runs as a scope hook, before the per-member rate limit.
  await app.register(async (scope) => {
    scope.addHook('preHandler', requireUser(auth));
    scope.withTypeProvider<ZodTypeProvider>().post(
      '/v1/me/checkins',
      {
        config: perUserLimit(10, 60 * 60_000),
        schema: { body: checkinInputSchema, response: { 201: checkinSchema } },
      },
      async (request, reply) =>
        reply.status(201).send(await checkins.create(currentUser(request).id, request.body)),
    );
  });

  // The rest also for a suspended account (safety first).
  await app.register(async (scope) => {
    scope.addHook('preHandler', requireUser(auth, { allowSuspended: true }));
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.get(
      '/v1/me/checkins/active',
      { schema: { response: { 200: z.object({ checkin: checkinSchema.nullable() }) } } },
      async (request) => ({ checkin: await checkins.active(currentUser(request).id) }),
    );
    r.post(
      '/v1/me/checkins/:id/ok',
      { schema: { params, response: { 200: ok } } },
      async (request) => {
        await checkins.ok(currentUser(request).id, request.params.id);
        return { ok: true as const };
      },
    );
    r.post(
      '/v1/me/checkins/:id/sos',
      {
        config: perUserLimit(10, 60 * 60_000),
        schema: { params, response: { 200: checkinSchema } },
      },
      async (request) => checkins.sos(currentUser(request).id, request.params.id),
    );
    r.post(
      '/v1/me/checkins/:id/extend',
      {
        config: perUserLimit(20, 60 * 60_000),
        schema: { params, body: checkinExtendSchema, response: { 200: checkinSchema } },
      },
      async (request) =>
        checkins.extend(currentUser(request).id, request.params.id, request.body.minutes),
    );
    r.delete(
      '/v1/me/checkins/:id',
      { schema: { params, response: { 200: ok } } },
      async (request) => {
        await checkins.cancel(currentUser(request).id, request.params.id);
        return { ok: true as const };
      },
    );
  });
};
