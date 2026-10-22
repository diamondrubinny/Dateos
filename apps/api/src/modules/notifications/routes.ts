import { schema, type Database } from '@nexaheart/db';
import {
  chatSettingsInputSchema,
  chatSettingsSchema,
  ErrorCode,
  pushTokenInputSchema,
} from '@nexaheart/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';

const { preferences, pushTokens } = schema;
const ok = z.object({ ok: z.literal(true) });

/** Per-person chat settings and opt-in push notification devices. */
export const notificationRoutes: FastifyPluginAsyncZod<{ auth: Auth; db: Database }> = async (
  app,
  { auth, db },
) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/me/settings',
    { schema: { response: { 200: chatSettingsSchema.extend({ pushDevices: z.number().int() }) } } },
    async (request) => {
      const userId = currentUser(request).id;
      const [prefs] = await db
        .select({ acceptVoice: preferences.acceptVoice, acceptCalls: preferences.acceptCalls })
        .from(preferences)
        .where(eq(preferences.userId, userId));
      const devices = await db
        .select({ token: pushTokens.token })
        .from(pushTokens)
        .where(eq(pushTokens.userId, userId));
      return {
        acceptVoice: prefs?.acceptVoice ?? true,
        acceptCalls: prefs?.acceptCalls ?? true,
        pushDevices: devices.length,
      };
    },
  );

  app.put(
    '/v1/me/settings',
    { schema: { body: chatSettingsInputSchema, response: { 200: ok } } },
    async (request) => {
      const updated = await db
        .update(preferences)
        .set({
          ...(request.body.acceptVoice !== undefined
            ? { acceptVoice: request.body.acceptVoice }
            : {}),
          ...(request.body.acceptCalls !== undefined
            ? { acceptCalls: request.body.acceptCalls }
            : {}),
        })
        .where(eq(preferences.userId, currentUser(request).id))
        .returning({ userId: preferences.userId });
      if (updated.length === 0)
        throw new HttpError(409, ErrorCode.Conflict, 'Finish setting up your profile first.');
      return { ok: true as const };
    },
  );

  app.post(
    '/v1/me/push-tokens',
    {
      schema: { body: pushTokenInputSchema, response: { 200: ok } },
      config: perUserLimit(20, 60 * 60 * 1000),
    },
    async (request) => {
      const { token, platform, locale } = request.body;
      const userId = currentUser(request).id;
      // A device belongs to whoever signed in on it last: re-registering moves the token.
      await db
        .insert(pushTokens)
        .values({ token, userId, platform, locale })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: { userId, platform, locale, createdAt: new Date() },
        });
      return { ok: true as const };
    },
  );

  app.delete(
    '/v1/me/push-tokens',
    { schema: { body: z.object({ token: z.string().max(200) }), response: { 200: ok } } },
    async (request) => {
      await db
        .delete(pushTokens)
        .where(
          and(
            eq(pushTokens.token, request.body.token),
            eq(pushTokens.userId, currentUser(request).id),
          ),
        );
      return { ok: true as const };
    },
  );
};
