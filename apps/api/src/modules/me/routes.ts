// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  consentsInputSchema,
  meResponseSchema,
  pauseInputSchema,
  preferencesSchema,
  profileInputSchema,
  profileUpdateSchema,
  promptsInputSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorCode } from '@nexaheart/shared';
import { z } from 'zod';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { MeService } from './service.js';

const ok = z.object({ ok: z.literal(true) });

/** What a suspended member can still do: see why, and delete the account (right to erasure). */
const allowedWhileSuspended = new Set(['GET /v1/me', 'DELETE /v1/me', 'GET /v1/me/export']);

export const meRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  me: MeService;
  /** Builds the member's data archive (ZIP). */
  exportData?: (userId: string) => Promise<Uint8Array>;
}> = async (app, { auth, me, exportData }) => {
  app.addHook('preHandler', requireUser(auth, { allowSuspended: true }));
  app.addHook('preHandler', async (request) => {
    const route = `${request.method} ${request.routeOptions.url ?? ''}`;
    if (currentUser(request).status === 'suspended' && !allowedWhileSuspended.has(route)) {
      throw new HttpError(403, ErrorCode.Forbidden, 'This account cannot perform this action.');
    }
  });

  app.get('/v1/me', { schema: { response: { 200: meResponseSchema } } }, async (request) =>
    me.getMe(currentUser(request).id),
  );

  app.post(
    '/v1/me/profile',
    { schema: { body: profileInputSchema, response: { 201: ok } } },
    async (request, reply) => {
      await me.createProfile(currentUser(request).id, request.body);
      return reply.status(201).send({ ok: true });
    },
  );

  app.patch(
    '/v1/me/profile',
    { schema: { body: profileUpdateSchema.strict(), response: { 200: ok } } },
    async (request) => {
      await me.updateProfile(currentUser(request).id, request.body);
      return { ok: true as const };
    },
  );

  app.put(
    '/v1/me/preferences',
    { schema: { body: preferencesSchema, response: { 200: ok } } },
    async (request) => {
      await me.setPreferences(currentUser(request).id, request.body);
      return { ok: true as const };
    },
  );

  app.put(
    '/v1/me/prompts',
    { schema: { body: z.object({ prompts: promptsInputSchema }), response: { 200: ok } } },
    async (request) => {
      await me.setPrompts(currentUser(request).id, request.body.prompts);
      return { ok: true as const };
    },
  );

  app.put(
    '/v1/me/consents',
    { schema: { body: z.object({ consents: consentsInputSchema }), response: { 200: ok } } },
    async (request) => {
      await me.recordConsents(currentUser(request).id, request.body.consents);
      return { ok: true as const };
    },
  );

  // Take a break (phase 18a). A small limit stops scripts from flickering a profile on and off.
  app.put(
    '/v1/me/pause',
    {
      schema: { body: pauseInputSchema, response: { 200: ok } },
      config: perUserLimit(30, 24 * 60 * 60 * 1000),
    },
    async (request) => {
      await me.pause(currentUser(request).id, request.body.duration);
      return { ok: true as const };
    },
  );

  app.delete(
    '/v1/me/pause',
    { schema: { response: { 200: ok } }, config: perUserLimit(30, 24 * 60 * 60 * 1000) },
    async (request) => {
      await me.resume(currentUser(request).id);
      return { ok: true as const };
    },
  );

  app.post(
    '/v1/me/notices/:id/ack',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: ok } } },
    async (request) => {
      await me.acknowledgeNotice(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );

  if (exportData) {
    app.get(
      '/v1/me/export',
      { config: perUserLimit(3, 24 * 60 * 60 * 1000) },
      async (request, reply) => {
        const userId = currentUser(request).id;
        const zip = await exportData(userId);
        return reply
          .type('application/zip')
          .header(
            'content-disposition',
            `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.zip"`,
          )
          .header('cache-control', 'no-store')
          .send(Buffer.from(zip));
      },
    );
  }

  app.delete('/v1/me', { schema: { response: { 200: ok } } }, async (request) => {
    await me.deleteAccount(currentUser(request).id);
    return { ok: true as const };
  });
};
