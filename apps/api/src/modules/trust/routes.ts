// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  contactHidesInputSchema,
  contactHidesSchema,
  inviteSchema,
  joinWaitlistSchema,
  redeemInviteSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { TrustService } from './service.js';

const HOUR = 60 * 60 * 1000;

/** Public, before an account exists: redeeming a code and joining the waitlist (per IP limits). */
export const signupRoutes: FastifyPluginAsyncZod<{ trust: TrustService }> = async (
  app,
  { trust },
) => {
  app.post(
    '/v1/signup/redeem',
    {
      config: { rateLimit: { max: 10, timeWindow: HOUR } },
      schema: { body: redeemInviteSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await trust.redeem(request.body.code, request.body.email);
      return reply.status(204).send(null);
    },
  );
  app.post(
    '/v1/signup/waitlist',
    {
      config: { rateLimit: { max: 5, timeWindow: HOUR } },
      schema: { body: joinWaitlistSchema, response: { 202: z.object({ ok: z.literal(true) }) } },
    },
    async (request, reply) => {
      await trust.joinWaitlist(request.body.email, request.body.note);
      return reply.status(202).send({ ok: true as const });
    },
  );
};

/** Signed in: hide me from my contacts, and personal invites. */
export const trustRoutes: FastifyPluginAsyncZod<{ auth: Auth; trust: TrustService }> = async (
  app,
  { auth, trust },
) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/me/contact-hides',
    { schema: { response: { 200: contactHidesSchema } } },
    async (request) => ({ hidden: await trust.contactHideCount(currentUser(request).id) }),
  );
  app.post(
    '/v1/me/contact-hides',
    {
      // Matching reads every member's address in memory, so it's limited per person.
      config: perUserLimit(5, HOUR),
      bodyLimit: 200_000,
      schema: { body: contactHidesInputSchema, response: { 200: contactHidesSchema } },
    },
    async (request) => trust.hideContacts(currentUser(request).id, request.body.hashes),
  );
  app.delete(
    '/v1/me/contact-hides',
    { schema: { response: { 200: contactHidesSchema } } },
    async (request) => {
      await trust.clearContactHides(currentUser(request).id);
      return { hidden: 0 };
    },
  );

  app.get(
    '/v1/me/invites',
    {
      schema: {
        response: { 200: z.object({ allowed: z.boolean(), invites: z.array(inviteSchema) }) },
      },
    },
    async (request) => trust.memberInvites(currentUser(request).id),
  );
  app.post(
    '/v1/me/invites',
    { config: perUserLimit(10, HOUR), schema: { response: { 201: inviteSchema } } },
    async (request, reply) =>
      reply.status(201).send(await trust.createMemberInvite(currentUser(request).id)),
  );
};
