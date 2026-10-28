// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { ACCOUNT_ACTIVITY_DAYS } from '@nexaheart/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { parseDeviceLabel } from './device-label.js';
import { signinAlertEmail, type Mailer } from './mailer.js';

/** At most this many alerts a day per account, so a flood of sign-ins can't flood the inbox. */
export const MAX_SIGNIN_ALERTS_PER_DAY = 3;

/** A device code in words, for the alert email. */
export function deviceWords(code: string): { he: string; en: string } {
  const d = parseDeviceLabel(code);
  if (d.kind === 'app') return { he: `האפליקציה · ${d.os}`, en: `NexaHeart app on ${d.os}` };
  if (d.kind === 'web') {
    const name = [d.browser, d.os].filter(Boolean).join(' · ');
    if (name) return { he: name, en: name };
  }
  return { he: 'מכשיר לא מזוהה', en: 'Unknown device' };
}

export interface SigninAlertDeps {
  db: Database;
  redis: Redis;
  mailer: Mailer;
  instanceName: string;
}

/**
 * Phase 32: emails the member when a kind of device the account hasn't used in the last 90 days
 * signs in (not on the account's first sign-in), unless they turned it off. Called right after the
 * sign-in was audited, so that sign-in is already counted.
 */
export async function maybeAlertNewDevice(
  deps: SigninAlertDeps,
  userId: string,
  device: string,
  now = new Date(),
): Promise<'sent' | 'first' | 'known' | 'off' | 'limit'> {
  const { auditLogs, preferences, user } = schema;
  const since = new Date(now.getTime() - ACCOUNT_ACTIVITY_DAYS * 86_400_000);
  const [counts] = await deps.db
    .select({
      total: sql<number>`count(*)::int`,
      same: sql<number>`count(*) FILTER (WHERE ${auditLogs.meta}->>'device' = ${device})::int`,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.actorId, userId),
        eq(auditLogs.action, 'session.created'),
        gt(auditLogs.createdAt, since),
      ),
    );
  if (!counts || counts.total <= 1) return 'first';
  if (counts.same > 1) return 'known';
  const [prefs] = await deps.db
    .select({ on: preferences.signinAlerts })
    .from(preferences)
    .where(eq(preferences.userId, userId));
  if (prefs && !prefs.on) return 'off';
  const key = `nexaheart:signin-alert:${userId}:${now.toISOString().slice(0, 10)}`;
  const sent = await deps.redis.incr(key);
  if (sent === 1) await deps.redis.expire(key, 86_400);
  if (sent > MAX_SIGNIN_ALERTS_PER_DAY) return 'limit';
  const [row] = await deps.db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  if (!row) return 'first';
  await deps.mailer.send({
    to: row.email,
    ...signinAlertEmail(deps.instanceName, deviceWords(device), now),
  });
  return 'sent';
}
