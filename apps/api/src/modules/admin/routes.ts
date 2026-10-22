import multipart from '@fastify/multipart';
import {
  auditEntrySchema,
  instanceSettingsInputSchema,
  MAX_PHOTO_BYTES,
  auditQuerySchema,
  decideVerificationSchema,
  ErrorCode,
  liftSuspensionSchema,
  mfaSetupSchema,
  reportDetailSchema,
  reportSummarySchema,
  resolveReportSchema,
  staffMeSchema,
  totpCodeSchema,
  verificationReviewSchema,
  adminVenueSchema,
  venueInputSchema,
  venueUpdateSchema,
} from '@nexaheart/shared';
import type { Storage, StoredObject } from '@nexaheart/storage';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';
import { adminSettingsSchema } from '../instance/routes.js';
import type { InstanceService } from '../instance/service.js';
import type { PhotoService } from '../photos/service.js';
import type { VerificationService } from '../safety/verification.js';
import type { VenueService } from '../dates/venues.js';
import { isStaffRole, type StaffMfaService } from './mfa.js';
import type { ModerationService } from './moderation.js';

const ok = z.object({ ok: z.literal(true) });
const idParams = z.object({ id: z.uuid() });

/** Routes a staff member can use before passing the TOTP step-up. */
const beforeMfa = new Set(['/v1/admin/me', '/v1/admin/mfa/setup', '/v1/admin/mfa/verify']);

function sendImage(reply: FastifyReply, object: StoredObject) {
  // Never cached by shared caches or the browser's disk: these are private member photos.
  return reply.type('image/webp').header('cache-control', 'no-store').send(object.body);
}

export const adminRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  mfa: StaffMfaService;
  moderation: ModerationService;
  verification: VerificationService;
  photos: PhotoService;
  instance: InstanceService;
  storage: Storage;
  venues: VenueService;
}> = async (app, { auth, mfa, moderation, verification, photos, instance, storage, venues }) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 },
  });
  app.addHook('preHandler', requireUser(auth));
  app.addHook('preHandler', async (request) => {
    // Roles are read from the database on every request, so revoking a role is immediate.
    const staff = currentUser(request);
    if (!isStaffRole(staff.role)) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Staff access only.');
    }
    if (!beforeMfa.has(request.routeOptions.url ?? '')) await mfa.requireVerified(staff);
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', reply.getHeader('cache-control') ?? 'no-store');
  });

  const adminOnly = (role: string) => {
    if (role !== 'admin') throw new HttpError(403, ErrorCode.Forbidden, 'Admins only.');
  };

  app.get('/v1/admin/me', { schema: { response: { 200: staffMeSchema } } }, async (request) =>
    mfa.status(currentUser(request)),
  );

  app.post(
    '/v1/admin/mfa/setup',
    { schema: { response: { 200: mfaSetupSchema } }, config: perUserLimit(10, 60 * 60 * 1000) },
    async (request) => mfa.setup(currentUser(request)),
  );

  app.post(
    '/v1/admin/mfa/verify',
    {
      schema: { body: totpCodeSchema, response: { 200: ok } },
      config: perUserLimit(10, 15 * 60 * 1000),
    },
    async (request) => {
      await mfa.verify(currentUser(request), request.body.code);
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/admin/reports',
    {
      schema: {
        querystring: z.object({ status: z.enum(['open', 'closed']).default('open') }),
        response: { 200: z.object({ reports: z.array(reportSummarySchema) }) },
      },
    },
    async (request) => ({ reports: await moderation.queue(request.query.status) }),
  );

  app.get(
    '/v1/admin/reports/:id',
    { schema: { params: idParams, response: { 200: reportDetailSchema } } },
    async (request) => moderation.detail(currentUser(request), request.params.id),
  );

  app.post(
    '/v1/admin/reports/:id/resolve',
    { schema: { params: idParams, body: resolveReportSchema, response: { 200: ok } } },
    async (request) => {
      await moderation.resolve(
        currentUser(request),
        request.params.id,
        request.body.action,
        request.body.reason,
      );
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/admin/reports/:id/evidence/:evidenceId/audio',
    {
      schema: {
        params: z.object({ id: z.uuid(), evidenceId: z.uuid() }),
        querystring: z.object({ format: z.enum(['aac', 'opus']).default('aac') }),
      },
    },
    async (request, reply) => {
      const key = await moderation.evidenceAudio(
        currentUser(request),
        request.params.id,
        request.params.evidenceId,
      );
      const opus = request.query.format === 'opus';
      const object = await storage.get(
        storage.buckets.media,
        opus ? key.replace(/\.m4a$/, '.webm') : key,
      );
      return reply
        .type(opus ? 'audio/webm' : 'audio/mp4')
        .header('cache-control', 'no-store')
        .send(object.body);
    },
  );

  app.post(
    '/v1/admin/users/:userId/unsuspend',
    {
      schema: {
        params: z.object({ userId: z.string().min(1).max(64) }),
        body: liftSuspensionSchema,
        response: { 200: ok },
      },
    },
    async (request) => {
      await moderation.liftSuspension(
        currentUser(request),
        request.params.userId,
        request.body.reason,
      );
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/admin/users/:userId/photos/:photoId',
    { schema: { params: z.object({ userId: z.string().min(1).max(64), photoId: z.uuid() }) } },
    async (request, reply) => {
      const { userId, photoId } = request.params;
      const object = await photos.openForStaff(photoId, 'profile', userId);
      await moderation.recordPhotoView(currentUser(request), userId, photoId);
      return sendImage(reply, object);
    },
  );

  app.get(
    '/v1/admin/verifications',
    {
      schema: { response: { 200: z.object({ verifications: z.array(verificationReviewSchema) }) } },
    },
    async () => ({ verifications: await verification.queue() }),
  );

  app.get(
    '/v1/admin/verifications/:id/selfie',
    { schema: { params: idParams } },
    async (request, reply) =>
      sendImage(reply, await verification.selfie(currentUser(request).id, request.params.id)),
  );

  app.post(
    '/v1/admin/verifications/:id',
    { schema: { params: idParams, body: decideVerificationSchema, response: { 200: ok } } },
    async (request) => {
      await verification.decide(currentUser(request).id, request.params.id, request.body.approve);
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/admin/audit',
    {
      schema: {
        querystring: auditQuerySchema,
        response: { 200: z.object({ entries: z.array(auditEntrySchema) }) },
      },
    },
    async (request) => {
      adminOnly(currentUser(request).role);
      return { entries: await moderation.auditLog(request.query.before, request.query.limit) };
    },
  );

  // ---------------------------------------------------------------- instance branding (admins)

  app.get('/v1/admin/instance', { schema: { response: { 200: adminSettingsSchema } } }, async () =>
    instance.adminSettings(),
  );

  app.patch(
    '/v1/admin/instance',
    {
      schema: {
        body: instanceSettingsInputSchema.strict(),
        response: { 200: adminSettingsSchema },
      },
    },
    async (request) => instance.update(currentUser(request), request.body),
  );

  app.post(
    '/v1/admin/instance/logo',
    { schema: { response: { 202: ok } }, config: perUserLimit(20, 60 * 60 * 1000) },
    async (request, reply) => {
      adminOnly(currentUser(request).role);
      const file = await request.file();
      if (!file) throw new HttpError(400, ErrorCode.BadRequest, 'Attach one image file.');
      await instance.setLogo(currentUser(request), await file.toBuffer());
      return reply.status(202).send({ ok: true as const });
    },
  );

  app.delete('/v1/admin/instance/logo', { schema: { response: { 200: ok } } }, async (request) => {
    await instance.removeLogo(currentUser(request));
    return { ok: true as const };
  });

  // Date planner places (phase 12): every staff member can see them, only admins change them.
  app.get(
    '/v1/admin/venues',
    { schema: { response: { 200: z.object({ venues: z.array(adminVenueSchema) }) } } },
    async () => ({ venues: await venues.listAll() }),
  );
  app.post(
    '/v1/admin/venues',
    {
      config: perUserLimit(100, 60 * 60 * 1000),
      schema: { body: venueInputSchema, response: { 201: adminVenueSchema } },
    },
    async (request, reply) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return reply.status(201).send(await venues.create(staff.id, request.body));
    },
  );
  app.patch(
    '/v1/admin/venues/:id',
    {
      config: perUserLimit(200, 60 * 60 * 1000),
      schema: { params: idParams, body: venueUpdateSchema, response: { 200: adminVenueSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return venues.update(staff.id, request.params.id, request.body);
    },
  );
};
