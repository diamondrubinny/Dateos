// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  resumeCardSchema,
  resumeLinkCreatedSchema,
  resumeLinkInputSchema,
  resumeLinksSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { ResumeService } from './service.js';

const HOUR = 60 * 60_000;
const ok = z.object({ ok: z.literal(true) });
const tokenParams = z.object({ token: z.string().min(20).max(64) });

/** Phase 68b, no sign-in: the résumé page and its watermarked photo. Never cached or indexed. */
export const resumePublicRoutes: FastifyPluginAsyncZod<{ resume: ResumeService }> = async (
  app,
  { resume },
) => {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', 'noindex, nofollow');
    reply.header('referrer-policy', 'no-referrer');
  });
  app.get(
    '/v1/resume/:token',
    {
      config: { rateLimit: { max: 30, timeWindow: HOUR } },
      schema: { params: tokenParams, response: { 200: resumeCardSchema } },
    },
    async (request) => resume.card(request.params.token),
  );
  app.get(
    '/v1/resume/:token/photo',
    {
      config: { rateLimit: { max: 30, timeWindow: HOUR } },
      schema: { params: tokenParams },
    },
    async (request, reply) =>
      reply.type('image/webp').send(await resume.photo(request.params.token)),
  );
};

/** Phase 68b, signed in: my résumé links. */
export const resumeRoutes: FastifyPluginAsyncZod<{ auth: Auth; resume: ResumeService }> = async (
  app,
  { auth, resume },
) => {
  app.addHook('preHandler', requireUser(auth));
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'private, no-store');
  });
  app.get(
    '/v1/me/resume-links',
    { schema: { response: { 200: resumeLinksSchema } } },
    async (request) => ({ links: await resume.list(currentUser(request).id) }),
  );
  app.post(
    '/v1/me/resume-links',
    {
      schema: { body: resumeLinkInputSchema, response: { 200: resumeLinkCreatedSchema } },
      config: perUserLimit(20, 24 * HOUR),
    },
    async (request) => resume.create(currentUser(request).id, request.body),
  );
  app.delete(
    '/v1/me/resume-links/:id',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: ok } } },
    async (request) => {
      await resume.end(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );
};
