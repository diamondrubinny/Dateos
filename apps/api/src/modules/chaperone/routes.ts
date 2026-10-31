// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  chaperoneJoinSchema,
  chaperoneLinkInfoSchema,
  chaperoneTranscriptSchema,
  chaperoningSchema,
  myChaperoneSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { ChaperoneService } from './service.js';

const ok = z.object({ ok: z.literal(true) });
const HOUR = 60 * 60_000;

/** Phase 68d: the member's chaperone, and the chaperone's read-only view. */
export const chaperoneRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  chaperones: ChaperoneService;
}> = async (app, { auth, chaperones }) => {
  app.addHook('preHandler', requireUser(auth));
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'private, no-store');
  });

  // ---------------------------------------------------------------- the member
  app.get(
    '/v1/me/chaperone',
    { schema: { response: { 200: myChaperoneSchema } } },
    async (request) => chaperones.mine(currentUser(request).id),
  );
  app.post(
    '/v1/me/chaperone/link',
    {
      schema: { response: { 200: z.object({ token: z.string(), expiresAt: z.string() }) } },
      config: perUserLimit(10, 24 * HOUR),
    },
    async (request) => chaperones.invite(currentUser(request).id),
  );
  app.delete('/v1/me/chaperone', { schema: { response: { 200: ok } } }, async (request) => {
    await chaperones.remove(currentUser(request).id);
    return { ok: true as const };
  });

  // ---------------------------------------------------------------- the chaperone
  app.get(
    '/v1/chaperone/links/:token',
    {
      schema: {
        params: z.object({ token: z.string().min(20).max(64) }),
        response: { 200: chaperoneLinkInfoSchema },
      },
      config: perUserLimit(20, HOUR),
    },
    async (request) => chaperones.linkInfo(request.params.token),
  );
  app.post(
    '/v1/chaperone/join',
    {
      schema: { body: chaperoneJoinSchema, response: { 200: ok } },
      config: perUserLimit(10, HOUR),
    },
    async (request) => {
      await chaperones.join(currentUser(request).id, request.body.token);
      return { ok: true as const };
    },
  );
  app.get(
    '/v1/chaperoning',
    { schema: { response: { 200: chaperoningSchema } } },
    async (request) => chaperones.chaperoning(currentUser(request).id),
  );
  app.get(
    '/v1/chaperoning/:memberId/:matchId',
    {
      schema: {
        params: z.object({ memberId: z.string().min(1).max(64), matchId: z.uuid() }),
        response: { 200: chaperoneTranscriptSchema },
      },
      config: perUserLimit(120, HOUR),
    },
    async (request) =>
      chaperones.transcript(
        currentUser(request).id,
        request.params.memberId,
        request.params.matchId,
      ),
  );
  app.delete(
    '/v1/chaperoning/:memberId',
    {
      schema: { params: z.object({ memberId: z.string().min(1).max(64) }), response: { 200: ok } },
    },
    async (request) => {
      await chaperones.stepDown(currentUser(request).id, request.params.memberId);
      return { ok: true as const };
    },
  );
};
