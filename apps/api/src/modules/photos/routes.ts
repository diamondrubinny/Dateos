// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import multipart from '@fastify/multipart';
import {
  ErrorCode,
  MAX_PHOTO_BYTES,
  photoDescriptionInputSchema,
  photoOrderSchema,
  photoSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { perUserLimit } from '../../plugins/security.js';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { PhotoService } from './service.js';

const idParams = z.object({ id: z.uuid() });

export const photoRoutes: FastifyPluginAsyncZod<{ auth: Auth; photos: PhotoService }> = async (
  app,
  { auth, photos },
) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 },
  });
  app.addHook('preHandler', requireUser(auth));

  app.post(
    '/v1/me/photos',
    {
      schema: { response: { 202: photoSchema } },
      config: perUserLimit(30, 60 * 60 * 1000),
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) throw new HttpError(400, ErrorCode.BadRequest, 'Attach one image file.');
      const buffer = await file.toBuffer(); // throws 413 above MAX_PHOTO_BYTES
      const photo = await photos.upload(currentUser(request).id, buffer);
      return reply.status(202).send(photo);
    },
  );

  app.get('/v1/photos/:id', { schema: { params: idParams } }, async (request, reply) => {
    const object = await photos.open(currentUser(request).id, request.params.id);
    return reply
      .type('image/webp')
      .header('cache-control', 'private, max-age=300')
      .send(object.body);
  });

  app.delete(
    '/v1/me/photos/:id',
    { schema: { params: idParams, response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request) => {
      await photos.remove(currentUser(request).id, request.params.id);
      return { ok: true as const };
    },
  );

  // Photo descriptions for screen readers (phase 40).
  app.put(
    '/v1/me/photos/:id/description',
    {
      schema: {
        params: idParams,
        body: photoDescriptionInputSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
      config: perUserLimit(60, 60_000),
    },
    async (request) => {
      await photos.describe(currentUser(request).id, request.params.id, request.body.description);
      return { ok: true as const };
    },
  );

  app.put(
    '/v1/me/photos/order',
    { schema: { body: photoOrderSchema, response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request) => {
      await photos.reorder(currentUser(request).id, request.body.photoIds);
      return { ok: true as const };
    },
  );
};
