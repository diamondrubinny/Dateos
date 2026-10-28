// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { ErrorCode, signedInDevicesSchema } from '@nexaheart/shared';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { audit } from '../../lib/audit.js';
import { parseDeviceLabel } from '../../lib/device-label.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';

const { session } = schema;
const ok = z.object({ ok: z.literal(true) });
const limit = perUserLimit(30, 60 * 1000);

/**
 * "Your devices" (phase 29): where a member is signed in, and signing out of one or all the others.
 * Deleting the session row signs that device out at its next request.
 */
export const deviceRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  db: Database;
  now?: () => number;
}> = async (app, { auth, db, now = Date.now }) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/me/sessions',
    { schema: { response: { 200: signedInDevicesSchema } }, config: limit },
    async (request) => {
      const me = currentUser(request);
      const rows = await db
        .select({
          id: session.id,
          label: session.deviceLabel,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })
        .from(session)
        .where(and(eq(session.userId, me.id), gt(session.expiresAt, new Date(now()))))
        .orderBy(desc(session.updatedAt));
      return {
        devices: rows.map((row) => ({
          id: row.id,
          device: parseDeviceLabel(row.label),
          signedInAt: row.createdAt.toISOString(),
          lastActiveAt: row.updatedAt.toISOString(),
          current: row.id === me.sessionId,
        })),
      };
    },
  );

  app.delete(
    '/v1/me/sessions/:id',
    {
      schema: { params: z.object({ id: z.string().min(1).max(64) }), response: { 200: ok } },
      config: limit,
    },
    async (request) => {
      const me = currentUser(request);
      // Someone else's session id looks exactly like one that doesn't exist.
      const deleted = await db
        .delete(session)
        .where(and(eq(session.id, request.params.id), eq(session.userId, me.id)))
        .returning({ id: session.id });
      if (deleted.length === 0) throw new HttpError(404, ErrorCode.NotFound, 'Not found.');
      await audit(db, {
        actorId: me.id,
        action: 'session.revoked',
        targetType: 'user',
        targetId: me.id,
        meta: { current: request.params.id === me.sessionId },
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/v1/me/sessions/sign-out-others',
    { schema: { response: { 200: ok.extend({ signedOut: z.number().int() }) } }, config: limit },
    async (request) => {
      const me = currentUser(request);
      const deleted = await db
        .delete(session)
        .where(and(eq(session.userId, me.id), ne(session.id, me.sessionId)))
        .returning({ id: session.id });
      await audit(db, {
        actorId: me.id,
        action: 'session.revoked_others',
        targetType: 'user',
        targetId: me.id,
        meta: { count: deleted.length },
      });
      return { ok: true as const, signedOut: deleted.length };
    },
  );
};
