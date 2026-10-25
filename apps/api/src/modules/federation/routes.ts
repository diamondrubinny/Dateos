// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  ErrorCode,
  FEDERATION_WELL_KNOWN,
  federatedDeliveryResponseSchema,
  federatedDiscoverResponseSchema,
  federatedLikeResponseSchema,
  federationIdentitySchema,
} from '@nexaheart/shared';
import { HttpError } from '../../plugins/error-handler.js';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FederatedChat } from './chat.js';
import type { FederatedMembers } from './members.js';
import type { FederatedSafety } from './safety.js';
import type { FederationService, IncomingSigned } from './service.js';

const ok = z.object({ ok: z.literal(true) });

declare module 'fastify' {
  interface FastifyRequest {
    /** The exact body bytes, for signature checks (phase 28). */
    rawBody?: string;
  }
}

/**
 * Communities that connect (phase 28a): the public identity, and the signed server-to-server API.
 * No user session here: every call is checked by its signature instead.
 */
export const federationRoutes: FastifyPluginAsyncZod<{
  federation: FederationService;
  members: FederatedMembers;
  chat: FederatedChat;
  safety: FederatedSafety;
}> = async (app, { federation, members, chat, safety }) => {
  // Keep the raw body: the signature covers the exact bytes that were sent.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: 128 * 1024 },
    (request, body, done) => {
      request.rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }), undefined);
      }
    },
  );
  const incoming = (request: FastifyRequest): IncomingSigned => ({
    method: request.method,
    path: request.url,
    headers: request.headers,
    body: request.rawBody ?? '',
  });
  // Few calls are expected between two servers: a tight limit per address.
  const limit = { rateLimit: { max: 60, timeWindow: 60_000 } };
  // Members browsing (28b): every deck, like and photo of a partner's members comes through here.
  const busy = { rateLimit: { max: 1200, timeWindow: 60_000 } };

  app.get(
    FEDERATION_WELL_KNOWN,
    { schema: { response: { 200: federationIdentitySchema } } },
    async (_request, reply) => {
      // Off: as if the route didn't exist.
      if (!federation.enabled) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
      return reply.header('cache-control', 'public, max-age=300').send(await federation.identity());
    },
  );
  app.post(
    '/v1/federation/invitations',
    { config: limit, schema: { response: { 200: ok } } },
    async (request) => {
      await federation.receiveInvitation(incoming(request));
      return { ok: true as const };
    },
  );
  app.post(
    '/v1/federation/accept',
    { config: limit, schema: { response: { 200: ok } } },
    async (request) => {
      await federation.receiveAccept(incoming(request));
      return { ok: true as const };
    },
  );
  app.post(
    '/v1/federation/end',
    { config: limit, schema: { response: { 200: ok } } },
    async (request) => {
      await federation.receiveEnd(incoming(request));
      return { ok: true as const };
    },
  );
  app.get(
    '/v1/federation/ping',
    { config: limit, schema: { response: { 200: ok } } },
    async (request) => {
      const { partner } = await federation.verify(incoming(request));
      if (!partner || partner.status !== 'active') {
        throw new HttpError(403, ErrorCode.Forbidden, 'Not connected.');
      }
      return { ok: true as const };
    },
  );

  // ---------------------------------------------------------------- 28b: members
  app.post(
    '/v1/federation/discover',
    { config: busy, schema: { response: { 200: federatedDiscoverResponseSchema } } },
    async (request) => members.receiveDiscover(incoming(request)),
  );
  app.post(
    '/v1/federation/likes',
    { config: busy, schema: { response: { 200: federatedLikeResponseSchema } } },
    async (request) => members.receiveLike(incoming(request)),
  );
  app.post(
    '/v1/federation/unmatch',
    { config: busy, schema: { response: { 200: ok } } },
    async (request) => {
      await members.receiveUnmatch(incoming(request));
      return { ok: true as const };
    },
  );
  app.post(
    '/v1/federation/forget',
    { config: busy, schema: { response: { 200: ok } } },
    async (request) => {
      await members.receiveForget(incoming(request));
      return { ok: true as const };
    },
  );
  app.get(
    '/v1/federation/photos/:id',
    {
      config: busy,
      schema: { params: z.object({ id: z.uuid() }), querystring: z.object({ viewer: z.string() }) },
    },
    async (request, reply) => {
      const object = await members.receivePhoto(
        incoming(request),
        request.params.id,
        request.query.viewer,
      );
      return reply
        .type('image/webp')
        .header('cache-control', 'private, max-age=300')
        .send(object.body);
    },
  );
  app.post(
    '/v1/federation/messages',
    { config: busy, schema: { response: { 200: federatedDeliveryResponseSchema } } },
    async (request) => chat.receive(incoming(request)),
  );

  // ---------------------------------------------------------------- 28d: safety
  app.post(
    '/v1/federation/reports',
    { config: limit, schema: { response: { 200: z.object({ accepted: z.boolean() }) } } },
    async (request) => safety.receiveReport(incoming(request)),
  );
  app.post(
    '/v1/federation/report-outcomes',
    { config: limit, schema: { response: { 200: ok } } },
    async (request) => {
      await safety.receiveOutcome(incoming(request));
      return { ok: true as const };
    },
  );
};
