import {
  consentsInputSchema,
  meResponseSchema,
  preferencesSchema,
  profileInputSchema,
  profileUpdateSchema,
  promptsInputSchema,
} from '@dateos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { MeService } from './service.js';

const ok = z.object({ ok: z.literal(true) });

export const meRoutes: FastifyPluginAsyncZod<{ auth: Auth; me: MeService }> = async (
  app,
  { auth, me },
) => {
  app.addHook('preHandler', requireUser(auth));

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

  app.delete('/v1/me', { schema: { response: { 200: ok } } }, async (request) => {
    await me.deleteAccount(currentUser(request).id);
    return { ok: true as const };
  });
};
