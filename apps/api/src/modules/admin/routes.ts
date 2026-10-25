// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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
  adminCheckInSchema,
  eventAnswerInputSchema,
  eventBoardSchema,
  partnerAcceptSchema,
  partnerInviteSchema,
  partnersResponseSchema,
  eventNoticeInputSchema,
  integrationIds,
  integrationsResponseSchema,
  integrationTestSchema,
  integrationUpdateSchema,
  integrationViewSchema,
  webhookDeliveriesSchema,
  adminEventSchema,
  eventInputSchema,
  eventUpdateSchema,
  createInviteSchema,
  inviteSchema,
  waitlistEntrySchema,
  waitlistStatuses,
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
import type { EventService } from '../events/service.js';
import type { FederationService } from '../federation/service.js';
import type { TrustService } from '../trust/service.js';
import type { IntegrationService } from '../integrations/service.js';
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
  events: EventService;
  trust: TrustService;
  integrations: IntegrationService;
  federation: FederationService;
}> = async (
  app,
  {
    auth,
    mfa,
    moderation,
    verification,
    photos,
    instance,
    storage,
    venues,
    events,
    trust,
    integrations,
    federation,
  },
) => {
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
  // ---------------------------------------------------------------- who may sign up (phase 21)

  app.get(
    '/v1/admin/invites',
    { schema: { response: { 200: z.object({ invites: z.array(inviteSchema) }) } } },
    async () => ({ invites: await trust.listInvites() }),
  );
  app.post(
    '/v1/admin/invites',
    {
      config: perUserLimit(100, 60 * 60 * 1000),
      schema: { body: createInviteSchema, response: { 201: inviteSchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await trust.createInvite(currentUser(request), request.body)),
  );
  app.post(
    '/v1/admin/invites/:id/revoke',
    { schema: { params: idParams, response: { 200: ok } } },
    async (request) => {
      await trust.revokeInvite(currentUser(request), request.params.id);
      return { ok: true as const };
    },
  );
  app.get(
    '/v1/admin/waitlist',
    {
      schema: {
        querystring: z.object({ status: z.enum(waitlistStatuses).default('pending') }),
        response: { 200: z.object({ entries: z.array(waitlistEntrySchema) }) },
      },
    },
    async (request) => ({ entries: await trust.listWaitlist(request.query.status) }),
  );
  app.post(
    '/v1/admin/waitlist/:id/:decision',
    {
      schema: {
        params: z.object({ id: z.uuid(), decision: z.enum(['approve', 'decline']) }),
        response: { 200: ok },
      },
    },
    async (request) => {
      await trust.decideWaitlist(
        currentUser(request),
        request.params.id,
        request.params.decision === 'approve',
      );
      return { ok: true as const };
    },
  );

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

  // Community events (phase 14): every staff member can see them, only admins change them.
  app.get(
    '/v1/admin/events',
    { schema: { response: { 200: z.object({ events: z.array(adminEventSchema) }) } } },
    async () => ({ events: await events.listForStaff() }),
  );
  app.post(
    '/v1/admin/events',
    {
      config: perUserLimit(100, 60 * 60 * 1000),
      schema: { body: eventInputSchema, response: { 201: adminEventSchema } },
    },
    async (request, reply) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return reply.status(201).send(await events.create(staff.id, request.body));
    },
  );
  app.patch(
    '/v1/admin/events/:id',
    {
      config: perUserLimit(200, 60 * 60 * 1000),
      schema: { params: idParams, body: eventUpdateSchema, response: { 200: adminEventSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return events.update(staff.id, request.params.id, request.body);
    },
  );
  app.post(
    '/v1/admin/events/:id/cancel',
    {
      config: perUserLimit(100, 60 * 60 * 1000),
      schema: { params: idParams, response: { 200: adminEventSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return events.cancel(staff.id, request.params.id);
    },
  );
  // The rotating check-in code to show at the venue (phase 23).
  app.get(
    '/v1/admin/events/:id/check-in',
    { schema: { params: idParams, response: { 200: adminCheckInSchema } } },
    async (request) => {
      adminOnly(currentUser(request).role);
      return events.checkInFor(request.params.id);
    },
  );

  // Updates and questions to the organizers (phase 27): questions come without who asked.
  app.get(
    '/v1/admin/events/:id/board',
    { schema: { params: idParams, response: { 200: eventBoardSchema } } },
    async (request) => events.staffBoard(request.params.id),
  );
  app.post(
    '/v1/admin/events/:id/updates',
    {
      config: perUserLimit(100, 60 * 60 * 1000),
      schema: {
        params: idParams,
        body: eventNoticeInputSchema,
        response: { 200: eventBoardSchema },
      },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return events.postUpdate(staff.id, request.params.id, request.body.body);
    },
  );
  app.delete(
    '/v1/admin/events/:id/updates/:updateId',
    {
      schema: {
        params: idParams.extend({ updateId: z.uuid() }),
        response: { 200: eventBoardSchema },
      },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return events.deleteUpdate(staff.id, request.params.id, request.params.updateId);
    },
  );
  app.post(
    '/v1/admin/events/:id/questions/:questionId/answer',
    {
      config: perUserLimit(200, 60 * 60 * 1000),
      schema: {
        params: idParams.extend({ questionId: z.uuid() }),
        body: eventAnswerInputSchema,
        response: { 200: eventBoardSchema },
      },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return events.answerQuestion(
        staff.id,
        request.params.id,
        request.params.questionId,
        request.body.answer,
      );
    },
  );

  // Communities that connect (phase 28a): moderators can see, admins decide.
  app.get(
    '/v1/admin/partners',
    { schema: { response: { 200: partnersResponseSchema } } },
    async () => federation.list(),
  );
  app.post(
    '/v1/admin/partners',
    {
      config: perUserLimit(20, 60 * 60 * 1000),
      schema: { body: partnerInviteSchema, response: { 200: partnersResponseSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return federation.invite(staff.id, request.body.url);
    },
  );
  app.post(
    '/v1/admin/partners/:id/accept',
    {
      config: perUserLimit(20, 60 * 60 * 1000),
      schema: {
        params: idParams,
        body: partnerAcceptSchema,
        response: { 200: partnersResponseSchema },
      },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return federation.accept(staff.id, request.params.id);
    },
  );
  app.post(
    '/v1/admin/partners/:id/end',
    { schema: { params: idParams, response: { 200: partnersResponseSchema } } },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return federation.end(staff.id, request.params.id);
    },
  );
  app.post(
    '/v1/admin/partners/:id/test',
    {
      config: perUserLimit(60, 60 * 60 * 1000),
      schema: { params: idParams, response: { 200: partnersResponseSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return federation.test(staff.id, request.params.id);
    },
  );
  // A new signing key for this community; partners are told with the old one.
  app.post(
    '/v1/admin/federation/rotate-key',
    {
      config: perUserLimit(10, 60 * 60 * 1000),
      schema: { response: { 200: partnersResponseSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return federation.rotateKey(staff.id);
    },
  );
  // 28d: suspend (nothing crosses, nothing deleted) and resume.
  for (const action of ['suspend', 'resume'] as const) {
    app.post(
      `/v1/admin/partners/:id/${action}`,
      { schema: { params: idParams, response: { 200: partnersResponseSchema } } },
      async (request) => {
        const staff = currentUser(request);
        adminOnly(staff.role);
        return federation[action](staff.id, request.params.id);
      },
    );
  }

  // Integrations (phase 24): admins only. Secrets go in, never come out.
  const integrationParams = z.object({ id: z.enum(integrationIds) });
  app.get(
    '/v1/admin/integrations',
    { schema: { response: { 200: integrationsResponseSchema } } },
    async (request) => {
      adminOnly(currentUser(request).role);
      return integrations.list();
    },
  );
  app.put(
    '/v1/admin/integrations/:id',
    {
      config: perUserLimit(60, 60 * 60 * 1000),
      schema: {
        params: integrationParams,
        body: integrationUpdateSchema,
        response: { 200: integrationViewSchema },
      },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return integrations.save(staff.id, request.params.id, request.body);
    },
  );
  app.post(
    '/v1/admin/integrations/:id/test',
    {
      config: perUserLimit(30, 60 * 60 * 1000),
      schema: { params: integrationParams, response: { 200: integrationTestSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return integrations.test(staff.id, request.params.id);
    },
  );
  app.delete(
    '/v1/admin/integrations/:id',
    {
      config: perUserLimit(60, 60 * 60 * 1000),
      schema: { params: integrationParams, response: { 200: integrationViewSchema } },
    },
    async (request) => {
      const staff = currentUser(request);
      adminOnly(staff.role);
      return integrations.remove(staff.id, request.params.id);
    },
  );
  app.get(
    '/v1/admin/webhooks/deliveries',
    { schema: { response: { 200: webhookDeliveriesSchema } } },
    async (request) => {
      adminOnly(currentUser(request).role);
      return integrations.deliveries();
    },
  );
};
