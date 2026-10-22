// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import multipart from '@fastify/multipart';
import {
  ErrorCode,
  MAX_PHOTO_BYTES,
  reportInputSchema,
  reportResultSchema,
  verificationStateSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';
import type { ReportService } from './reports.js';
import type { VerificationService } from './verification.js';

export const safetyRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  reports: ReportService;
  verification: VerificationService;
  /** Reporting someone hangs up any call with them (phase 15). */
  onReported?: (reporterId: string, targetId: string) => Promise<void>;
}> = async (app, { auth, reports, verification, onReported }) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 },
  });
  app.addHook('preHandler', requireUser(auth));

  app.post(
    '/v1/reports',
    {
      schema: { body: reportInputSchema, response: { 201: reportResultSchema } },
      config: perUserLimit(20, 24 * 60 * 60 * 1000),
    },
    async (request, reply) => {
      const reporterId = currentUser(request).id;
      const result = await reports.create(reporterId, request.body);
      await onReported?.(reporterId, request.body.targetId).catch(() => undefined);
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/v1/me/verification',
    { schema: { response: { 200: verificationStateSchema } } },
    async (request) => verification.state(currentUser(request).id),
  );

  app.post(
    '/v1/me/verification',
    {
      schema: { response: { 200: verificationStateSchema } },
      config: perUserLimit(10, 60 * 60 * 1000),
    },
    async (request) => verification.start(currentUser(request).id),
  );

  app.post(
    '/v1/me/verification/selfie',
    {
      schema: { response: { 202: verificationStateSchema } },
      config: perUserLimit(10, 60 * 60 * 1000),
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) throw new HttpError(400, ErrorCode.BadRequest, 'Attach one image file.');
      const buffer = await file.toBuffer();
      return reply
        .status(202)
        .send(await verification.submitSelfie(currentUser(request).id, buffer));
    },
  );
};
