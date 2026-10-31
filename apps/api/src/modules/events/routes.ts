// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  checkInSchema,
  eventBoardSchema,
  eventQuestionInputSchema,
  eventQuestionSchema,
  eventSchema,
  meetAgainPickSchema,
  meetAgainSchema,
  myNoShowsSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { MeetAgainService } from './meet-again.js';
import type { EventService } from './service.js';

const params = z.object({ id: z.uuid() });

/** Community events for members (phase 14). Staff manage them under /v1/admin/events. */
export const eventRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  events: EventService;
  meetAgain: MeetAgainService;
}> = async (app, { auth, events, meetAgain }) => {
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
  // Updates and questions to the organizers (phase 27): only for people going or waiting.
  app.get(
    '/v1/events/:id/board',
    { schema: { params, response: { 200: eventBoardSchema } } },
    async (request) => events.board(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/events/:id/questions',
    {
      config: perUserLimit(20, 60 * 60_000),
      schema: { params, body: eventQuestionInputSchema, response: { 200: eventQuestionSchema } },
    },
    async (request) => events.ask(request.params.id, currentUser(request).id, request.body.body),
  );
  app.delete(
    '/v1/events/:id/questions/:questionId',
    {
      config: limit,
      schema: {
        params: params.extend({ questionId: z.uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await events.deleteQuestion(
        request.params.id,
        currentUser(request).id,
        request.params.questionId,
      );
      return { ok: true as const };
    },
  );
  // Checking in with the code on the venue's screen (phase 23). Few tries: codes are 6 digits.
  app.post(
    '/v1/events/:id/check-in',
    {
      config: perUserLimit(10, 60 * 60_000),
      schema: { params, body: checkInSchema, response: { 200: eventSchema } },
    },
    async (request) =>
      events.checkIn(request.params.id, currentUser(request).id, request.body.code),
  );

  // "Meet again" after an in-person event (phase 71a): only for people who checked in.
  app.get(
    '/v1/events/:id/meet-again',
    { schema: { params, response: { 200: meetAgainSchema } } },
    async (request) => meetAgain.state(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/events/:id/meet-again',
    { config: limit, schema: { params, response: { 200: meetAgainSchema } } },
    async (request) => meetAgain.join(request.params.id, currentUser(request).id),
  );
  app.put(
    '/v1/events/:id/meet-again/:userId',
    {
      config: perUserLimit(120, 60 * 60_000),
      schema: {
        params: params.extend({ userId: z.string().min(1).max(64) }),
        body: meetAgainPickSchema,
        response: { 200: meetAgainSchema },
      },
    },
    async (request) =>
      meetAgain.pick(
        request.params.id,
        currentUser(request).id,
        request.params.userId,
        request.body.yes,
      ),
  );
  // Missed events (phase 71a): private to the member, with one excuse a month.
  app.get(
    '/v1/me/event-misses',
    { schema: { response: { 200: myNoShowsSchema } } },
    async (request) => events.myNoShows(currentUser(request).id),
  );
  app.post(
    '/v1/me/event-misses/:id/excuse',
    { config: limit, schema: { params, response: { 200: myNoShowsSchema } } },
    async (request) => events.excuse(currentUser(request).id, request.params.id),
  );
};
