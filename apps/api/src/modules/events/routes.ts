// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { eventSchema } from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { EventService } from './service.js';

const params = z.object({ id: z.uuid() });

/** Community events for members (phase 14). Staff manage them under /v1/admin/events. */
export const eventRoutes: FastifyPluginAsyncZod<{ auth: Auth; events: EventService }> = async (
  app,
  { auth, events },
) => {
  // An active account: suspended members can't say they're going.
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/events',
    { schema: { response: { 200: z.object({ events: z.array(eventSchema) }) } } },
    async (request) => ({ events: await events.listUpcoming(currentUser(request).id) }),
  );
  app.get(
    '/v1/events/:id',
    { schema: { params, response: { 200: eventSchema } } },
    async (request) => events.get(request.params.id, currentUser(request).id),
  );

  const limit = perUserLimit(60, 60 * 60_000);
  app.post(
    '/v1/events/:id/rsvp',
    { config: limit, schema: { params, response: { 200: eventSchema } } },
    async (request) => events.rsvp(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/events/:id/waitlist',
    { config: limit, schema: { params, response: { 200: eventSchema } } },
    async (request) => events.joinWaitlist(request.params.id, currentUser(request).id),
  );
  // Leaves the event or its waiting list, whichever the member is on.
  app.delete(
    '/v1/events/:id/rsvp',
    { config: limit, schema: { params, response: { 200: eventSchema } } },
    async (request) => events.cancelRsvp(request.params.id, currentUser(request).id),
  );
};
