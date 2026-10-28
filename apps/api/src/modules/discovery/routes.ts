// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  blockInputSchema,
  discoverQuerySchema,
  interactionInputSchema,
  interactionResultSchema,
  undoPassResultSchema,
  saveProfileInputSchema,
  publicProfileSchema,
  likeReceivedSchema,
  locationInputSchema,
  matchSummarySchema,
  closeMatchSchema,
  closedConversationSchema,
  YOUR_TURN_LIMIT,
  yourTurnSchema,
  blockedPersonSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { perUserLimit } from '../../plugins/security.js';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { DiscoveryService } from './service.js';

const ok = z.object({ ok: z.literal(true) });

export const discoveryRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  discovery: DiscoveryService;
}> = async (app, { auth, discovery }) => {
  app.addHook('preHandler', requireUser(auth));

  app.put(
    '/v1/me/location',
    // Coordinates must not end up in logs, so the body is never logged (see logger redaction too).
    {
      schema: { body: locationInputSchema, response: { 200: ok } },
      config: perUserLimit(30, 60_000),
    },
    async (request) => {
      await discovery.setLocation(currentUser(request).id, request.body);
      return { ok: true as const };
    },
  );

  app.delete('/v1/me/location', { schema: { response: { 200: ok } } }, async (request) => {
    await discovery.clearLocation(currentUser(request).id);
    return { ok: true as const };
  });

  app.get(
    '/v1/discover',
    {
      schema: {
        querystring: discoverQuerySchema,
        response: { 200: z.object({ profiles: z.array(publicProfileSchema) }) },
      },
    },
    async (request) => ({
      profiles: await discovery.discover(currentUser(request).id, request.query.limit),
    }),
  );

  // Friends mode (phase 22): its own deck.
  app.get(
    '/v1/friends/discover',
    {
      schema: {
        querystring: discoverQuerySchema,
        response: { 200: z.object({ profiles: z.array(publicProfileSchema) }) },
      },
    },
    async (request) => ({
      profiles: await discovery.discoverFriends(currentUser(request).id, request.query.limit),
    }),
  );

  // Focus mode (phase 20): how many people are waiting for this member's reply.
  app.get(
    '/v1/me/your-turn',
    { schema: { response: { 200: yourTurnSchema } } },
    async (request) => ({
      waiting: await discovery.waitingForReply(currentUser(request).id),
      limit: YOUR_TURN_LIMIT,
    }),
  );

  app.get(
    '/v1/picks/today',
    { schema: { response: { 200: z.object({ profiles: z.array(publicProfileSchema) }) } } },
    async (request) => ({ profiles: await discovery.picksToday(currentUser(request).id) }),
  );

  app.get(
    '/v1/profiles/:id',
    {
      schema: {
        params: z.object({ id: z.string().min(1).max(64) }),
        response: { 200: publicProfileSchema },
      },
    },
    async (request) => discovery.profile(currentUser(request).id, request.params.id),
  );

  app.post(
    '/v1/interactions',
    {
      schema: { body: interactionInputSchema, response: { 200: interactionResultSchema } },
      config: perUserLimit(60, 60_000),
    },
    async (request) => discovery.interact(currentUser(request).id, request.body),
  );

  // "Maybe later" (phase 33): private, up to 30.
  app.get(
    '/v1/saved',
    {
      schema: { response: { 200: z.object({ profiles: z.array(publicProfileSchema) }) } },
      config: perUserLimit(60, 60_000),
    },
    async (request) => ({ profiles: await discovery.saved(currentUser(request).id) }),
  );

  app.post(
    '/v1/saved',
    {
      schema: { body: saveProfileInputSchema, response: { 200: ok } },
      config: perUserLimit(60, 60_000),
    },
    async (request) => {
      await discovery.saveForLater(currentUser(request).id, request.body.targetId);
      return { ok: true as const };
    },
  );

  app.delete(
    '/v1/saved/:id',
    {
      schema: { params: z.object({ id: z.string().min(1).max(64) }), response: { 200: ok } },
      config: perUserLimit(60, 60_000),
    },
    async (request) => {
      await discovery.removeSaved(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/v1/interactions/undo',
    { schema: { response: { 200: undoPassResultSchema } }, config: perUserLimit(30, 60_000) },
    async (request) => discovery.undoPass(currentUser(request).id),
  );

  app.get(
    '/v1/likes',
    { schema: { response: { 200: z.object({ likes: z.array(likeReceivedSchema) }) } } },
    async (request) => ({ likes: await discovery.likesReceived(currentUser(request).id) }),
  );

  app.get(
    '/v1/matches',
    { schema: { response: { 200: z.object({ matches: z.array(matchSummarySchema) }) } } },
    async (request) => ({ matches: await discovery.matches(currentUser(request).id) }),
  );

  app.delete(
    '/v1/matches/:id',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: ok } } },
    async (request) => {
      await discovery.unmatch(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/v1/matches/:id/close',
    {
      config: perUserLimit(30, 60 * 60_000),
      schema: { params: z.object({ id: z.uuid() }), body: closeMatchSchema, response: { 200: ok } },
    },
    async (request) => {
      await discovery.unmatch(currentUser(request).id, request.params.id, request.body.message);
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/matches/closed',
    { schema: { response: { 200: z.object({ closed: z.array(closedConversationSchema) }) } } },
    async (request) => ({ closed: await discovery.closedConversations(currentUser(request).id) }),
  );

  app.post(
    '/v1/matches/:id/closed/dismiss',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: ok } } },
    async (request) => {
      await discovery.dismissClosed(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );

  // Blocked people (phase 35): see and take back my own blocks.
  app.get(
    '/v1/blocks',
    {
      schema: { response: { 200: z.object({ blocked: z.array(blockedPersonSchema) }) } },
      config: perUserLimit(60, 60_000),
    },
    async (request) => ({ blocked: await discovery.blocked(currentUser(request).id) }),
  );

  app.delete(
    '/v1/blocks/:userId',
    {
      schema: { params: z.object({ userId: z.string().min(1).max(64) }), response: { 200: ok } },
      config: perUserLimit(30, 60_000),
    },
    async (request) => {
      await discovery.unblock(currentUser(request).id, request.params.userId);
      return { ok: true as const };
    },
  );

  app.post(
    '/v1/blocks',
    { schema: { body: blockInputSchema, response: { 200: ok } } },
    async (request) => {
      await discovery.block(currentUser(request).id, request.body.userId);
      return { ok: true as const };
    },
  );
};
