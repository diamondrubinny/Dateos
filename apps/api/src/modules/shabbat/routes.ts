// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { shabbatSettingsInputSchema, shabbatSettingsSchema } from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { ShabbatService } from './service.js';

/** Phase 74a: the member's Shabbat and holiday mode. */
export const shabbatRoutes: FastifyPluginAsyncZod<{ auth: Auth; shabbat: ShabbatService }> = async (
  app,
  { auth, shabbat },
) => {
  app.addHook('preHandler', requireUser(auth));
  app.get(
    '/v1/me/shabbat',
    { schema: { response: { 200: shabbatSettingsSchema } } },
    async (request) => shabbat.settings(currentUser(request).id),
  );
  app.put(
    '/v1/me/shabbat',
    {
      config: perUserLimit(60, 60 * 60 * 1000),
      schema: { body: shabbatSettingsInputSchema, response: { 200: shabbatSettingsSchema } },
    },
    async (request) => shabbat.update(currentUser(request).id, request.body),
  );
};
