// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { isWebPushEndpoint, type PushJob, type WebPushPayload } from '@nexaheart/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import webpush from 'web-push';

const { pushTokens, webPushSubscriptions } = schema;

/** At most one push per person, conversation and kind in this window. */
export const PUSH_THROTTLE_SECONDS = 120;

/** Phase 60: what the worker needs to send to browsers (VAPID keys from the install command). */
export interface WebPushSettings {
  publicKey: string;
  privateKey: string;
  /** Who sends: the community's address (https://DOMAIN), as push services ask. */
  subject: string;
  /** For tests: what posts the encrypted notification (default: the web-push library). */
  send?: typeof webpush.sendNotification;
}

export interface PushContext {
  db: Database;
  redis: Redis;
  log: Pick<Logger, 'info' | 'warn'>;
  provider: 'disabled' | 'expo';
  /** Phase 60: notifications in the web app; absent when the server has no keys. */
  webPush?: WebPushSettings | undefined;
  /** 📘 https://docs.expo.dev/push-notifications/sending-notifications/ */
  expoUrl: string;
  expoAccessToken?: string | undefined;
  fetch?: typeof fetch;
}

const texts = {
  en: {
    message: 'You have a new message',
    match: "It's a match! Say hello",
    checkin: 'Time to check in: let us know you are OK',
    event: 'Update about a community event you are going to',
    call: 'You have an incoming call',
    visible: 'Your break is over: new people can see your profile again',
    introduction: 'You have a new introduction from a community matchmaker',
  },
  he: {
    message: 'יש לך הודעה חדשה',
    match: 'יש התאמה! כדאי להגיד שלום',
    checkin: 'הגיע הזמן לאשר שהכול בסדר',
    event: 'עדכון על אירוע קהילה שנרשמת אליו',
    call: 'יש לך שיחה נכנסת',
    visible: 'ההפסקה הסתיימה: אנשים חדשים יכולים לראות שוב את הפרופיל שלך',
    introduction: 'יש לך הצעת היכרות חדשה משדכנות הקהילה',
  },
  ar: {
    message: 'لديك رسالة جديدة',
    match: 'هناك توافق! قل مرحبًا',
    checkin: 'حان وقت التأكيد: أخبرنا أنك بخير',
    event: 'تحديث حول فعالية مجتمعية سجّلت حضورك فيها',
    call: 'لديك مكالمة واردة',
    visible: 'انتهت الاستراحة: يمكن لأشخاص جدد رؤية ملفك الشخصي مرة أخرى',
    introduction: 'لديك اقتراح تعارف جديد في المجتمع',
  },
  ru: {
    message: 'У вас новое сообщение',
    match: 'Это взаимно! Напишите привет',
    checkin: 'Пора отметиться: сообщите, что всё в порядке',
    event: 'Новости о мероприятии сообщества, на которое вы идёте',
    call: 'Вам звонят',
    visible: 'Перерыв закончился: новые люди снова видят ваш профиль',
    introduction: 'Вам предложили новое знакомство в сообществе',
  },
} as const;

/** Phase 67a: discreet notifications say nothing about the community or what happened. */
const discreetTexts = {
  en: { title: 'New notification', body: 'You have something new' },
  he: { title: 'התראה חדשה', body: 'יש משהו חדש' },
  ar: { title: 'إشعار جديد', body: 'لديك شيء جديد' },
  ru: { title: 'Новое уведомление', body: 'У вас что-то новое' },
} as const;

/**
 * Notifications pass through Expo, Apple and Google, so they never contain names, message text
 * or photos: only the community name and a generic sentence. Phase 67a: discreet ones not even
 * that, for a lock screen someone else may see.
 */
export function pushContent(
  kind: PushJob['kind'],
  locale: string,
  instanceName: string,
  discreet = false,
) {
  const lang = Object.hasOwn(texts, locale) ? (locale as keyof typeof texts) : 'en';
  if (discreet) return { ...discreetTexts[lang] };
  // A message from a partner community (phase 28c) reads like any other message.
  return { title: instanceName, body: texts[lang][kind === 'partner_message' ? 'message' : kind] };
}

export type PushResult =
  | 'disabled'
  | 'inactive'
  | 'online'
  | 'muted'
  | 'off'
  | 'quiet'
  | 'throttled'
  | 'no-devices'
  | 'sent';

/** Whether it's now within the member's quiet hours (which may cross midnight). */
async function inQuietHours(ctx: PushContext, userId: string): Promise<boolean> {
  // A zone the device knows but Postgres doesn't would throw: then no quiet hours, never a lost push.
  const result = await ctx.db
    .execute(
      sql`
    SELECT 1 FROM preferences p,
      LATERAL (SELECT EXTRACT(HOUR FROM now() AT TIME ZONE p.quiet_time_zone) * 60
                    + EXTRACT(MINUTE FROM now() AT TIME ZONE p.quiet_time_zone) AS m) local
    WHERE p.user_id = ${userId} AND p.quiet_start IS NOT NULL AND p.quiet_end IS NOT NULL
      AND p.quiet_time_zone IS NOT NULL
      AND CASE WHEN p.quiet_start < p.quiet_end
               THEN local.m >= p.quiet_start AND local.m < p.quiet_end
               ELSE local.m >= p.quiet_start OR local.m < p.quiet_end END`,
    )
    .catch(() => ({ rows: [] }));
  return result.rows.length > 0;
}

export async function sendPush(ctx: PushContext, job: PushJob): Promise<PushResult> {
  if (ctx.provider === 'disabled' && !ctx.webPush) return 'disabled';
  // Notifications the member turned off (phase 33). Calls and safety check-ins are always on.
  const choice =
    job.kind === 'match' || job.kind === 'introduction'
      ? 'notify_matches'
      : job.kind === 'message' || job.kind === 'partner_message'
        ? 'notify_messages'
        : job.kind === 'event'
          ? 'notify_events'
          : null;
  if (choice) {
    const off = await ctx.db.execute(
      sql`SELECT 1 FROM preferences WHERE user_id = ${job.userId} AND NOT ${sql.raw(choice)}`,
    );
    if (off.rows.length > 0) return 'off';
  }
  // Quiet hours (phase 39), in the member's own time zone; calls and safety check-ins still come.
  if (job.kind !== 'call' && job.kind !== 'checkin' && (await inQuietHours(ctx, job.userId))) {
    return 'quiet';
  }
  if (job.kind === 'checkin') return sendToDevices(ctx, job); // safety: no match or presence check
  if (job.kind === 'event') return sendToDevices(ctx, job); // not about a conversation
  if (job.kind === 'visible') return sendToDevices(ctx, job); // about the member's own profile
  if (job.kind === 'introduction') return sendToDevices(ctx, job); // not a conversation yet
  if (job.kind === 'partner_message') {
    // Still a match across communities, and the member still active?
    const live = await ctx.db.execute<{ ok: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM federation_matches fm JOIN "user" u ON u.id = fm.user_id
        WHERE fm.id = ${job.matchId} AND fm.user_id = ${job.userId} AND u.status = 'active'
      ) AS ok`);
    if (!live.rows[0]?.ok) return 'inactive';
    if (await ctx.redis.exists(`nexaheart:presence:${job.userId}`)) return 'online';
    return sendToDevices(ctx, job);
  }
  // Still a valid conversation? (Unmatch, block or suspension since the job was queued.)
  const active = await ctx.db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM matches m JOIN "user" a ON a.id = m.user_a JOIN "user" b ON b.id = m.user_b
      WHERE m.id = ${job.matchId} AND m.unmatched_at IS NULL
        AND (m.user_a = ${job.userId} OR m.user_b = ${job.userId})
        AND a.status = 'active' AND b.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = m.user_a AND bl.blocked_id = m.user_b) OR (bl.blocker_id = m.user_b AND bl.blocked_id = m.user_a))
    ) AS ok`);
  if (!active.rows[0]?.ok) return 'inactive';
  // A chat the member muted (phase 31): no message pushes. Calls and safety alerts aren't muted.
  if (job.kind === 'message') {
    const muted = await ctx.db.execute(sql`
      SELECT 1 FROM match_prefs WHERE match_id = ${job.matchId} AND user_id = ${job.userId} AND muted`);
    if (muted.rows.length > 0) return 'muted';
  }
  // Someone with the app open sees the message live; no need to buzz their phone.
  if (await ctx.redis.exists(`nexaheart:presence:${job.userId}`)) return 'online';
  return sendToDevices(ctx, job);
}

async function sendToDevices(ctx: PushContext, job: PushJob): Promise<PushResult> {
  const tokens =
    ctx.provider === 'expo'
      ? await ctx.db.select().from(pushTokens).where(eq(pushTokens.userId, job.userId))
      : [];
  const browsers = ctx.webPush
    ? await ctx.db
        .select()
        .from(webPushSubscriptions)
        .where(eq(webPushSubscriptions.userId, job.userId))
    : [];
  if (tokens.length === 0 && browsers.length === 0) return 'no-devices';
  const throttle = await ctx.redis.set(
    `nexaheart:push:throttle:${job.userId}:${job.matchId}:${job.kind}`,
    '1',
    'EX',
    PUSH_THROTTLE_SECONDS,
    'NX',
  );
  if (throttle !== 'OK') return 'throttled';

  const [settings] = await ctx.db
    .execute<{
      name: string | null;
      discreet: string | null;
    }>(sql`SELECT name, discreet_name AS discreet FROM instance_settings WHERE id = 1`)
    .then((r) => r.rows);
  // Phase 67b: a discreet app's neutral name, never the community's, on every notification.
  const instanceName =
    settings?.discreet ?? settings?.name ?? process.env.INSTANCE_NAME ?? 'NexaHeart';
  const discreet =
    (
      await ctx.db.execute<{ yes: boolean }>(
        sql`SELECT discreet_notifications AS yes FROM preferences WHERE user_id = ${job.userId}`,
      )
    ).rows[0]?.yes ?? false;
  // Browsers first: a failure there never makes the queue retry (and repeat) the phones.
  if (browsers.length > 0 && ctx.webPush)
    await sendToBrowsers(ctx, ctx.webPush, browsers, job, instanceName, discreet);
  if (tokens.length > 0) await sendToPhones(ctx, tokens, job, instanceName, discreet);
  return 'sent';
}

/**
 * Phase 60: to each browser, encrypted to it (RFC 8291) and signed with this server's key (VAPID):
 * the push service can't read it. The same content as on the phone. A subscription the service says
 * is gone (404/410) is deleted; other failures are logged without the address.
 */
async function sendToBrowsers(
  ctx: PushContext,
  settings: WebPushSettings,
  browsers: (typeof webPushSubscriptions.$inferSelect)[],
  job: PushJob,
  instanceName: string,
  discreet: boolean,
): Promise<void> {
  const send = settings.send ?? webpush.sendNotification.bind(webpush);
  const gone: string[] = [];
  const delivered: string[] = [];
  for (const b of browsers) {
    // Checked when it was saved; checked again before the server posts anywhere.
    if (!isWebPushEndpoint(b.endpoint)) {
      gone.push(b.endpoint);
      continue;
    }
    const payload: WebPushPayload = {
      ...pushContent(job.kind, b.locale, instanceName, discreet),
      kind: job.kind,
      id: job.matchId,
    };
    try {
      await send(
        { endpoint: b.endpoint, keys: { p256dh: b.p256dh, auth: b.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: settings.subject,
            publicKey: settings.publicKey,
            privateKey: settings.privateKey,
          },
          TTL: job.kind === 'call' ? 60 : 24 * 3600,
          urgency: job.kind === 'call' || job.kind === 'checkin' ? 'high' : 'normal',
          timeout: 10_000,
        },
      );
      delivered.push(b.endpoint);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(b.endpoint);
      else
        ctx.log.warn(
          { status: status ?? null, service: new URL(b.endpoint).hostname },
          'web push failed',
        );
    }
  }
  if (gone.length > 0) {
    await ctx.db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.endpoint, gone));
    ctx.log.info({ removed: gone.length }, 'removed expired browser subscriptions');
  }
  if (delivered.length > 0) {
    await ctx.db
      .update(webPushSubscriptions)
      .set({ lastUsedAt: new Date() })
      .where(inArray(webPushSubscriptions.endpoint, delivered));
  }
}

async function sendToPhones(
  ctx: PushContext,
  tokens: (typeof pushTokens.$inferSelect)[],
  job: PushJob,
  instanceName: string,
  discreet: boolean,
): Promise<void> {
  const messages = tokens.map((t) => ({
    to: t.token,
    ...pushContent(job.kind, t.locale, instanceName, discreet),
    sound: 'default',
    priority: 'high',
    // Only an opaque id, so the app can open the right chat.
    data: { type: job.kind, matchId: job.matchId },
  }));
  const res = await (ctx.fetch ?? fetch)(ctx.expoUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(ctx.expoAccessToken ? { authorization: `Bearer ${ctx.expoAccessToken}` } : {}),
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`push provider answered ${res.status}`); // retried by the queue
  const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
  const gone = (body.data ?? []).flatMap((ticket, i) =>
    ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
      ? [tokens[i]!.token]
      : [],
  );
  if (gone.length > 0) {
    await ctx.db.delete(pushTokens).where(inArray(pushTokens.token, gone));
    ctx.log.info({ removed: gone.length }, 'removed unregistered push tokens');
  }
  await ctx.db
    .update(pushTokens)
    .set({ lastUsedAt: new Date() })
    .where(
      inArray(
        pushTokens.token,
        tokens.map((t) => t.token).filter((t) => !gone.includes(t)),
      ),
    );
}
