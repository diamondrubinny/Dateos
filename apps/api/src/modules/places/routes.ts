// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  placeSchema,
  placesQuerySchema,
  travelInputSchema,
  travelStateSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { CityIndex } from './cities.js';
import type { TravelService } from './service.js';

/** City search and travel mode (phase 18c). Members only. */
export const travelRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  cities: CityIndex;
  travel: TravelService;
}> = async (app, { auth, cities, travel }) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/places',
    {
      schema: {
        querystring: placesQuerySchema,
        response: { 200: z.object({ places: z.array(placeSchema) }) },
      },
      config: perUserLimit(120, 60 * 60_000),
    },
    async (request) => ({ places: cities.search(request.query.q) }),
  );

  app.get(
    '/v1/me/travel',
    { schema: { response: { 200: z.object({ travel: travelStateSchema }) } } },
    async (request) => ({ travel: await travel.state(currentUser(request).id) }),
  );

  // At most 3 trips a day: hopping between cities is how someone would map a community.
  app.put(
    '/v1/me/travel',
    {
      schema: {
        body: travelInputSchema,
        response: { 200: z.object({ travel: travelStateSchema }) },
      },
      config: perUserLimit(3, 24 * 60 * 60_000),
    },
    async (request) => ({ travel: await travel.start(currentUser(request).id, request.body) }),
  );

  app.delete(
    '/v1/me/travel',
    { schema: { response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request) => {
      await travel.end(currentUser(request).id);
      return { ok: true as const };
    },
  );
};
