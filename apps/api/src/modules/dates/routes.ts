// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  availabilityInputSchema,
  availabilitySchema,
  dateFeedbackInputSchema,
  messageViewSchema,
  proposeDateSchema,
  venueSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { DateService } from './service.js';
import type { VenueService } from './venues.js';

const params = z.object({ id: z.uuid() });

/** Date planner for members (phase 12). Places are managed under /v1/admin/venues. */
export const dateRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  dates: DateService;
  venues: VenueService;
}> = async (app, { auth, dates, venues }) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/venues',
    { schema: { response: { 200: z.object({ venues: z.array(venueSchema) }) } } },
    async () => ({ venues: await venues.listActive() }),
  );

  app.post(
    '/v1/matches/:id/dates',
    {
      config: perUserLimit(30, 60 * 60_000),
      schema: { params, body: proposeDateSchema, response: { 201: messageViewSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await dates.propose(request.params.id, currentUser(request).id, request.body)),
  );

  const limit = perUserLimit(60, 60 * 60_000);
  app.post(
    '/v1/dates/:id/accept',
    { config: limit, schema: { params, response: { 200: messageViewSchema } } },
    async (request) => dates.respond(request.params.id, currentUser(request).id, 'accept'),
  );
  app.post(
    '/v1/dates/:id/decline',
    { config: limit, schema: { params, response: { 200: messageViewSchema } } },
    async (request) => dates.respond(request.params.id, currentUser(request).id, 'decline'),
  );
  app.post(
    '/v1/dates/:id/cancel',
    { config: limit, schema: { params, response: { 200: messageViewSchema } } },
    async (request) => dates.cancel(request.params.id, currentUser(request).id),
  );

  // Phase 20: "did you meet?" (private) and when you're both free (only the overlap is shown).
  app.post(
    '/v1/dates/:id/feedback',
    {
      config: limit,
      schema: { params, body: dateFeedbackInputSchema, response: { 200: messageViewSchema } },
    },
    async (request) => dates.feedback(request.params.id, currentUser(request).id, request.body),
  );
  app.get(
    '/v1/matches/:id/availability',
    { schema: { params, response: { 200: availabilitySchema } } },
    async (request) => dates.availability(request.params.id, currentUser(request).id),
  );
  app.put(
    '/v1/matches/:id/availability',
    {
      config: limit,
      schema: { params, body: availabilityInputSchema, response: { 200: availabilitySchema } },
    },
    async (request) =>
      dates.setAvailability(request.params.id, currentUser(request).id, request.body.slots),
  );
};
