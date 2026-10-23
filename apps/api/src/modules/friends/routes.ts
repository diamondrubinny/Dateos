// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  doubleMessageSchema,
  doubleSchema,
  friendTakeSchema,
  myPairSchema,
  pairCardSchema,
  pairDecisionSchema,
  pairInviteSchema,
  sendDoubleMessageSchema,
  takeLinkInfoSchema,
  takeLinkSchema,
  takeTokenSchema,
  writeTakeSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { PairService } from './pairs.js';
import type { TakeService } from './takes.js';

const HOUR = 60 * 60 * 1000;
const ok = z.object({ ok: z.literal(true) });
const idParams = z.object({ id: z.uuid() });
const tokenParams = z.object({ token: takeTokenSchema });

/** Public: a friend writing a take through a one-time link, without an account (per IP limits). */
export const takePublicRoutes: FastifyPluginAsyncZod<{ takes: TakeService }> = async (
  app,
  { takes },
) => {
  app.get(
    '/v1/takes/:token',
    {
      config: { rateLimit: { max: 10, timeWindow: HOUR } },
      schema: { params: tokenParams, response: { 200: takeLinkInfoSchema } },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return takes.linkInfo(request.params.token);
    },
  );
  app.post(
    '/v1/takes/:token',
    {
      config: { rateLimit: { max: 5, timeWindow: HOUR } },
      schema: { params: tokenParams, body: writeTakeSchema, response: { 201: ok } },
    },
    async (request, reply) => {
      await takes.write(request.params.token, request.body);
      return reply.status(201).send({ ok: true as const });
    },
  );
};

/** Signed in: managing takes, the pair, double dates and their group chats. */
export const friendRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  takes: TakeService;
  pairs: PairService;
}> = async (app, { auth, takes, pairs }) => {
  app.addHook('preHandler', requireUser(auth));

  // ---------------------------------------------------------------- friends' takes
  app.post(
    '/v1/me/takes/link',
    { config: perUserLimit(20, HOUR), schema: { response: { 201: takeLinkSchema } } },
    async (request, reply) =>
      reply.status(201).send(await takes.createLink(currentUser(request).id)),
  );
  app.get(
    '/v1/me/takes',
    { schema: { response: { 200: z.object({ takes: z.array(friendTakeSchema) }) } } },
    async (request) => ({ takes: await takes.list(currentUser(request).id) }),
  );
  app.post(
    '/v1/me/takes/:id/approve',
    { schema: { params: idParams, response: { 200: ok } } },
    async (request) => {
      await takes.approve(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );
  app.delete(
    '/v1/me/takes/:id',
    { schema: { params: idParams, response: { 200: ok } } },
    async (request) => {
      await takes.remove(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );

  // ---------------------------------------------------------------- the pair
  app.post(
    '/v1/pairs/invite',
    { config: perUserLimit(20, HOUR), schema: { response: { 201: pairInviteSchema } } },
    async (request, reply) => reply.status(201).send(await pairs.invite(currentUser(request).id)),
  );
  app.post(
    '/v1/pairs/join/:token',
    {
      config: perUserLimit(20, HOUR),
      schema: { params: tokenParams, response: { 200: myPairSchema } },
    },
    async (request) => pairs.join(currentUser(request).id, request.params.token),
  );
  app.get(
    '/v1/me/pair',
    { schema: { response: { 200: z.object({ pair: myPairSchema.nullable() }) } } },
    async (request) => ({ pair: await pairs.myPair(currentUser(request).id) }),
  );
  app.delete('/v1/me/pair', { schema: { response: { 200: ok } } }, async (request) => {
    await pairs.leavePair(currentUser(request).id);
    return { ok: true as const };
  });

  // ---------------------------------------------------------------- double dates
  app.get(
    '/v1/pairs/discover',
    { schema: { response: { 200: z.object({ pairs: z.array(pairCardSchema) }) } } },
    async (request) => ({ pairs: await pairs.discover(currentUser(request).id) }),
  );
  for (const kind of ['like', 'pass'] as const) {
    app.post(
      `/v1/pairs/:id/${kind}`,
      {
        config: perUserLimit(200, 24 * HOUR),
        schema: { params: idParams, response: { 200: pairDecisionSchema } },
      },
      async (request) => pairs.decide(currentUser(request).id, request.params.id, kind),
    );
  }
  app.get(
    '/v1/doubles',
    { schema: { response: { 200: z.object({ doubles: z.array(doubleSchema) }) } } },
    async (request) => ({ doubles: await pairs.doubles(currentUser(request).id) }),
  );
  app.get(
    '/v1/doubles/:id/messages',
    {
      schema: {
        params: idParams,
        querystring: z.object({ before: z.iso.datetime().optional() }),
        response: { 200: z.object({ messages: z.array(doubleMessageSchema) }) },
      },
    },
    async (request) => ({
      messages: await pairs.messages(
        request.params.id,
        currentUser(request).id,
        request.query.before,
      ),
    }),
  );
  app.post(
    '/v1/doubles/:id/messages',
    {
      config: perUserLimit(30, 60_000),
      schema: {
        params: idParams,
        body: sendDoubleMessageSchema,
        response: { 200: doubleMessageSchema },
      },
    },
    async (request) =>
      pairs.send(
        request.params.id,
        currentUser(request).id,
        request.body.text,
        request.body.clientId,
      ),
  );
  app.post(
    '/v1/doubles/:id/leave',
    { schema: { params: idParams, response: { 200: ok } } },
    async (request) => {
      await pairs.leave(request.params.id, currentUser(request).id);
      return { ok: true as const };
    },
  );
};
