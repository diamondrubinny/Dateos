// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  consoleQuerySchema,
  consoleSchema,
  introductionAnswerSchema,
  introductionInputSchema,
  introductionOutcomeSchema,
  introductionStates,
  myIntroductionsSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { IntroductionService } from './service.js';

const ok = z.object({ ok: z.literal(true) });
const idParams = z.object({ id: z.uuid() });

/** Phase 68a: introductions by community matchmakers (members' and matchmakers' routes). */
export const introductionRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  introductions: IntroductionService;
}> = async (app, { auth, introductions }) => {
  app.addHook('preHandler', requireUser(auth));
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'private, no-store');
  });

  app.get(
    '/v1/me/introductions',
    { schema: { response: { 200: myIntroductionsSchema } } },
    async (request) => introductions.mine(currentUser(request).id),
  );

  app.put(
    '/v1/introductions/:id/answer',
    {
      schema: {
        params: idParams,
        body: introductionAnswerSchema,
        response: {
          200: z.object({ state: z.enum(introductionStates), matchId: z.uuid().nullable() }),
        },
      },
      config: perUserLimit(60, 60 * 60_000),
    },
    async (request) =>
      introductions.answer(currentUser(request).id, request.params.id, request.body.answer),
  );

  app.put(
    '/v1/introductions/:id/outcome',
    {
      schema: { params: idParams, body: introductionOutcomeSchema, response: { 200: ok } },
      config: perUserLimit(30, 60 * 60_000),
    },
    async (request) => {
      await introductions.outcome(currentUser(request).id, request.params.id, request.body.outcome);
      return { ok: true as const };
    },
  );

  // ---------------------------------------------------------------- community matchmakers

  app.get(
    '/v1/introductions/console',
    {
      schema: { querystring: consoleQuerySchema, response: { 200: consoleSchema } },
      config: perUserLimit(120, 60 * 60_000),
    },
    async (request) => introductions.console(currentUser(request).id, request.query),
  );

  app.post(
    '/v1/introductions',
    {
      schema: { body: introductionInputSchema, response: { 200: z.object({ id: z.uuid() }) } },
      config: perUserLimit(40, 60 * 60_000),
    },
    async (request) => introductions.introduce(currentUser(request).id, request.body),
  );
};
