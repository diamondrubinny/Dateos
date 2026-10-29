// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { emailChangeConfirmSchema, emailChangeInputSchema } from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireRecentSignIn, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { EmailChangeService } from './email-change.js';

/** Changing the account's email (phase 41). Both steps need the member signed in. */
export const accountRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  emailChange: EmailChangeService;
}> = async (app, { auth, emailChange }) => {
  app.addHook('preHandler', requireUser(auth));

  app.post(
    '/v1/me/email',
    {
      schema: {
        body: emailChangeInputSchema,
        response: { 202: z.object({ ok: z.literal(true) }) },
      },
      config: perUserLimit(3, 60 * 60 * 1000),
    },
    async (request, reply) => {
      // Phase 43: moving the account to another mailbox needs a recent sign-in.
      requireRecentSignIn(request);
      await emailChange.request(currentUser(request).id, request.body.email);
      // The same answer whatever happened.
      return reply.code(202).send({ ok: true as const });
    },
  );

  app.post(
    '/v1/me/email/confirm',
    {
      schema: {
        body: emailChangeConfirmSchema,
        response: { 200: z.object({ email: z.string() }) },
      },
      config: perUserLimit(10, 10 * 60 * 1000),
    },
    async (request) => {
      const me = currentUser(request);
      return emailChange.confirm(me.id, me.sessionId, request.body.token);
    },
  );
};
