// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash, timingSafeEqual } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  chatSettingsInputSchema,
  chatSettingsSchema,
  ErrorCode,
  pushTokenInputSchema,
  WEB_PUSH_MAX_PER_ACCOUNT,
  webPushSubscriptionSchema,
} from '@nexaheart/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';

const { audioClips, preferences, pushTokens, webPushSubscriptions } = schema;
const ok = z.object({ ok: z.literal(true) });

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Per-person chat settings and opt-in push notification devices. */
export const notificationRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  db: Database;
  /** Phase 60: WEB_PUSH_PUBLIC_KEY is set (the worker has the private one). */
  webPush?: boolean;
}> = async (app, { auth, db, webPush = false }) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/me/settings',
    { schema: { response: { 200: chatSettingsSchema.extend({ pushDevices: z.number().int() }) } } },
    async (request) => {
      const userId = currentUser(request).id;
      const [prefs] = await db
        .select({
          acceptVoice: preferences.acceptVoice,
          acceptCalls: preferences.acceptCalls,
          allowTranscripts: preferences.allowTranscripts,
          readReceipts: preferences.readReceipts,
          signinAlerts: preferences.signinAlerts,
          notifyMatches: preferences.notifyMatches,
          notifyMessages: preferences.notifyMessages,
          notifyEvents: preferences.notifyEvents,
          quietStart: preferences.quietStart,
          quietEnd: preferences.quietEnd,
          quietTimeZone: preferences.quietTimeZone,
          dailyLikeLimit: preferences.dailyLikeLimit,
          verifiedContactOnly: preferences.verifiedContactOnly,
          blurPhotos: preferences.blurPhotos,
          hideDistance: preferences.hideDistance,
          discreetNotifications: preferences.discreetNotifications,
          openToMatchmakers: preferences.openToMatchmakers,
          friendSuggestions: preferences.friendSuggestions,
          appBadge: preferences.appBadge,
        })
        .from(preferences)
        .where(eq(preferences.userId, userId));
      const devices = await db
        .select({ token: pushTokens.token })
        .from(pushTokens)
        .where(eq(pushTokens.userId, userId));
      const browsers = await db
        .select({ endpoint: webPushSubscriptions.endpoint })
        .from(webPushSubscriptions)
        .where(eq(webPushSubscriptions.userId, userId));
      return {
        acceptVoice: prefs?.acceptVoice ?? true,
        acceptCalls: prefs?.acceptCalls ?? true,
        allowTranscripts: prefs?.allowTranscripts ?? true,
        readReceipts: prefs?.readReceipts ?? true,
        signinAlerts: prefs?.signinAlerts ?? true,
        notifyMatches: prefs?.notifyMatches ?? true,
        notifyMessages: prefs?.notifyMessages ?? true,
        notifyEvents: prefs?.notifyEvents ?? true,
        quietHours:
          prefs && prefs.quietStart !== null && prefs.quietEnd !== null && prefs.quietTimeZone
            ? { start: prefs.quietStart, end: prefs.quietEnd, timeZone: prefs.quietTimeZone }
            : null,
        dailyLikeLimit: prefs?.dailyLikeLimit ?? null,
        verifiedContactOnly: prefs?.verifiedContactOnly ?? false,
        blurPhotos: prefs?.blurPhotos ?? false,
        hideDistance: prefs?.hideDistance ?? false,
        discreetNotifications: prefs?.discreetNotifications ?? false,
        openToMatchmakers: prefs?.openToMatchmakers ?? false,
        friendSuggestions: prefs?.friendSuggestions ?? true,
        appBadge: prefs?.appBadge ?? true,
        pushDevices: devices.length + browsers.length,
      };
    },
  );

  app.put(
    '/v1/me/settings',
    { schema: { body: chatSettingsInputSchema, response: { 200: ok } } },
    async (request) => {
      const { quietHours, ...flags } = request.body;
      const updated = await db
        .update(preferences)
        // Only the settings sent are changed.
        .set({
          ...Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined)),
          // Quiet hours (phase 39): null turns them off.
          ...(quietHours !== undefined
            ? {
                quietStart: quietHours?.start ?? null,
                quietEnd: quietHours?.end ?? null,
                quietTimeZone: quietHours?.timeZone ?? null,
              }
            : {}),
        })
        .where(eq(preferences.userId, currentUser(request).id))
        .returning({ userId: preferences.userId });
      if (updated.length === 0)
        throw new HttpError(409, ErrorCode.Conflict, 'Finish setting up your profile first.');
      // "Voice only" (phase 26): texts already made from my voice are deleted too.
      if (request.body.allowTranscripts === false) {
        await db
          .update(audioClips)
          .set({ transcript: null, transcriptStatus: null })
          .where(eq(audioClips.userId, currentUser(request).id));
      }
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
      const { token, platform, locale, deviceSecret } = request.body;
      const userId = currentUser(request).id;
      const secretHash = deviceSecret ? sha256(deviceSecret) : null;
      const [existing] = await db
        .select({ userId: pushTokens.userId, secretHash: pushTokens.deviceSecretHash })
        .from(pushTokens)
        .where(eq(pushTokens.token, token));
      // A device belongs to whoever signed in on it last (phase 29): moving a token to another
      // account needs the same installation's secret, so knowing someone's token isn't enough to
      // silence their notifications. A token from before phase 29 takes the first secret it gets.
      if (
        existing &&
        existing.userId !== userId &&
        existing.secretHash !== null &&
        !(secretHash !== null && safeEqual(existing.secretHash, secretHash))
      ) {
        throw new HttpError(409, ErrorCode.Conflict, 'This device is registered to someone else.');
      }
      // The same account keeps its secret; only a new (or first) secret is written.
      const keepSecret = existing && existing.userId === userId && existing.secretHash !== null;
      await db
        .insert(pushTokens)
        .values({ token, userId, platform, locale, deviceSecretHash: secretHash })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: {
            userId,
            platform,
            locale,
            createdAt: new Date(),
            ...(keepSecret ? {} : { deviceSecretHash: secretHash }),
          },
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
  // Phase 60: a browser's Web Push subscription. Its address is a browser push service's (an
  // allow-list, checked by the schema): the worker posts nowhere else. The address is unguessable
  // and belongs to one browser, so whoever signed in there last owns it.
  app.post(
    '/v1/me/web-push',
    {
      schema: { body: webPushSubscriptionSchema, response: { 200: ok } },
      config: perUserLimit(20, 60 * 60 * 1000),
    },
    async (request) => {
      if (!webPush) {
        throw new HttpError(
          503,
          ErrorCode.ServiceUnavailable,
          'Notifications in the web app are not set up on this server.',
        );
      }
      const userId = currentUser(request).id;
      const { endpoint, keys, locale } = request.body;
      await db
        .insert(webPushSubscriptions)
        .values({ endpoint, userId, p256dh: keys.p256dh, auth: keys.auth, locale })
        .onConflictDoUpdate({
          target: webPushSubscriptions.endpoint,
          set: { userId, p256dh: keys.p256dh, auth: keys.auth, locale, createdAt: new Date() },
        });
      // At most WEB_PUSH_MAX_PER_ACCOUNT browsers: the oldest beyond it are dropped.
      await db.execute(sql`
        DELETE FROM web_push_subscriptions WHERE user_id = ${userId} AND endpoint NOT IN (
          SELECT endpoint FROM web_push_subscriptions WHERE user_id = ${userId}
          ORDER BY created_at DESC LIMIT ${WEB_PUSH_MAX_PER_ACCOUNT})`);
      return { ok: true as const };
    },
  );

  app.delete(
    '/v1/me/web-push',
    { schema: { body: z.object({ endpoint: z.string().max(1000) }), response: { 200: ok } } },
    async (request) => {
      await db
        .delete(webPushSubscriptions)
        .where(
          and(
            eq(webPushSubscriptions.endpoint, request.body.endpoint),
            eq(webPushSubscriptions.userId, currentUser(request).id),
          ),
        );
      return { ok: true as const };
    },
  );
};
