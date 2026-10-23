// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  joinCallSchema,
  speedAnswerSchema,
  speedDateSchema,
  speedJoinSchema,
  speedStateSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { SpeedService } from './service.js';

const params = z.object({ id: z.uuid() });

/** Video speed dating (phase 23): the lobby of an event, its rounds and the private answers. */
export const speedRoutes: FastifyPluginAsyncZod<{ auth: Auth; speed: SpeedService }> = async (
  app,
  { auth, speed },
) => {
  app.addHook('preHandler', requireUser(auth));
  // Heartbeats every 15 seconds and a refresh every few: generous, but bounded.
  const often = perUserLimit(600, 60 * 60_000);

  app.post(
    '/v1/events/:id/speed/lobby',
    { config: often, schema: { params, response: { 200: speedStateSchema } } },
    async (request) => speed.enter(request.params.id, currentUser(request).id),
  );
  app.delete(
    '/v1/events/:id/speed/lobby',
    { config: often, schema: { params, response: { 200: speedStateSchema } } },
    async (request) => speed.leaveLobby(request.params.id, currentUser(request).id),
  );
  app.get(
    '/v1/events/:id/speed',
    { config: often, schema: { params, response: { 200: speedStateSchema } } },
    async (request) => speed.state(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/speed-dates/:id/join',
    {
      config: perUserLimit(120, 60 * 60_000),
      schema: { params, body: joinCallSchema, response: { 200: speedJoinSchema } },
    },
    async (request) =>
      speed.join(request.params.id, currentUser(request).id, request.body.publicKey),
  );
  app.post(
    '/v1/speed-dates/:id/leave',
    {
      config: perUserLimit(120, 60 * 60_000),
      schema: { params, response: { 200: speedDateSchema } },
    },
    async (request) => speed.leave(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/speed-dates/:id/answer',
    {
      config: perUserLimit(120, 60 * 60_000),
      schema: { params, body: speedAnswerSchema, response: { 200: speedDateSchema } },
    },
    async (request) => speed.answer(request.params.id, currentUser(request).id, request.body.yes),
  );
};
