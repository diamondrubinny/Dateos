// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  ageCheckCallbackSchema,
  ageCheckStartSchema,
  ageCheckStateSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { AgeCheckService } from './service.js';

const ok = z.object({ ok: z.literal(true) });

/** Phase 63: the member's side (signed in) and the provider's signed callback (no session). */
export const ageCheckRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  ageCheck: AgeCheckService;
}> = async (app, { auth, ageCheck }) => {
  app.register(async (member) => {
    member.addHook('preHandler', requireUser(auth));
    member.get(
      '/v1/me/age-check',
      { schema: { response: { 200: ageCheckStateSchema } } },
      async (request) => ageCheck.state(currentUser(request).id),
    );
    member.post(
      '/v1/me/age-check',
      {
        schema: { response: { 200: ageCheckStartSchema } },
        config: perUserLimit(10, 60 * 60 * 1000),
      },
      async (request) => ageCheck.start(currentUser(request).id),
    );
  });

  app.post(
    '/v1/age-check/callback',
    {
      schema: {
        body: ageCheckCallbackSchema,
        headers: z.object({ 'x-nexaheart-signature': z.string().max(128) }).loose(),
        response: { 200: ok },
      },
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request) => {
      await ageCheck.receive(request.body, request.headers['x-nexaheart-signature']);
      return { ok: true as const };
    },
  );
};
