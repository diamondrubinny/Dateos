// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  federatedInteractionSchema,
  federatedJoinSchema,
  federatedMatchSchema,
  federatedProfileSchema,
  federatedStatusSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { FederatedMembers } from './members.js';

const MINUTE = 60 * 1000;
const ok = z.object({ ok: z.literal(true) });

/** Partner communities for members (phase 28b): join, the deck, likes, matches, photos. */
export const federatedRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  members: FederatedMembers;
}> = async (app, { auth, members }) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/federated/status',
    { schema: { response: { 200: federatedStatusSchema } } },
    async (request) => members.status(currentUser(request).id),
  );
  app.post(
    '/v1/federated/join',
    {
      config: perUserLimit(20, 60 * MINUTE),
      schema: { body: federatedJoinSchema, response: { 200: federatedStatusSchema } },
    },
    async (request) => members.join(currentUser(request).id, request.body.version),
  );
  app.post(
    '/v1/federated/leave',
    {
      config: perUserLimit(20, 60 * MINUTE),
      schema: { response: { 200: federatedStatusSchema } },
    },
    async (request) => members.leave(currentUser(request).id),
  );
  app.get(
    '/v1/federated/deck',
    {
      config: perUserLimit(30, MINUTE),
      schema: { response: { 200: z.array(federatedProfileSchema) } },
    },
    async (request) => members.deck(currentUser(request).id),
  );
  app.post(
    '/v1/federated/interactions',
    {
      config: perUserLimit(60, MINUTE),
      schema: {
        body: federatedInteractionSchema,
        response: { 200: z.object({ matched: z.boolean() }) },
      },
    },
    async (request) => members.interact(currentUser(request).id, request.body),
  );
  app.get(
    '/v1/federated/matches',
    { schema: { response: { 200: z.array(federatedMatchSchema) } } },
    async (request) => members.matches(currentUser(request).id),
  );
  app.delete(
    '/v1/federated/matches/:id',
    {
      config: perUserLimit(30, MINUTE),
      schema: { params: z.object({ id: z.uuid() }), response: { 200: ok } },
    },
    async (request) => {
      await members.unmatch(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );
  app.get(
    '/v1/federated/photos/:partnerId/:photoId',
    {
      config: perUserLimit(300, MINUTE),
      schema: { params: z.object({ partnerId: z.uuid(), photoId: z.uuid() }) },
    },
    async (request, reply) => {
      const image = await members.photo(
        currentUser(request).id,
        request.params.partnerId,
        request.params.photoId,
      );
      return reply
        .type('image/webp')
        .header('cache-control', 'private, max-age=300')
        .header('x-content-type-options', 'nosniff')
        .send(image);
    },
  );
};
