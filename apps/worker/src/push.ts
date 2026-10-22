import { schema, type Database } from '@nexaheart/db';
import type { PushJob } from '@nexaheart/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

const { pushTokens } = schema;

/** At most one push per person, conversation and kind in this window. */
export const PUSH_THROTTLE_SECONDS = 120;

export interface PushContext {
  db: Database;
  redis: Redis;
  log: Pick<Logger, 'info' | 'warn'>;
  provider: 'disabled' | 'expo';
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
  },
  he: {
    message: 'יש לך הודעה חדשה',
    match: 'יש התאמה! כדאי להגיד שלום',
    checkin: 'הגיע הזמן לאשר שהכול בסדר',
  },
  ar: {
    message: 'لديك رسالة جديدة',
    match: 'هناك توافق! قل مرحبًا',
    checkin: 'حان وقت التأكيد: أخبرنا أنك بخير',
  },
  ru: {
    message: 'У вас новое сообщение',
    match: 'Это взаимно! Напишите привет',
    checkin: 'Пора отметиться: сообщите, что всё в порядке',
  },
} as const;

/**
 * Notifications pass through Expo, Apple and Google, so they never contain names, message text
 * or photos: only the community name and a generic sentence.
 */
export function pushContent(kind: PushJob['kind'], locale: string, instanceName: string) {
  const lang = Object.hasOwn(texts, locale) ? (locale as keyof typeof texts) : 'en';
  return { title: instanceName, body: texts[lang][kind] };
}

export type PushResult = 'disabled' | 'inactive' | 'online' | 'throttled' | 'no-devices' | 'sent';

export async function sendPush(ctx: PushContext, job: PushJob): Promise<PushResult> {
  if (ctx.provider === 'disabled') return 'disabled';
  if (job.kind === 'checkin') return sendToDevices(ctx, job); // safety: no match or presence check
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
  // Someone with the app open sees the message live; no need to buzz their phone.
  if (await ctx.redis.exists(`nexaheart:presence:${job.userId}`)) return 'online';
  return sendToDevices(ctx, job);
}

async function sendToDevices(ctx: PushContext, job: PushJob): Promise<PushResult> {
  const tokens = await ctx.db.select().from(pushTokens).where(eq(pushTokens.userId, job.userId));
  if (tokens.length === 0) return 'no-devices';
  const throttle = await ctx.redis.set(
    `nexaheart:push:throttle:${job.userId}:${job.matchId}:${job.kind}`,
    '1',
    'EX',
    PUSH_THROTTLE_SECONDS,
    'NX',
  );
  if (throttle !== 'OK') return 'throttled';

  const [settings] = await ctx.db
    .execute<{ name: string | null }>(sql`SELECT name FROM instance_settings WHERE id = 1`)
    .then((r) => r.rows);
  const instanceName = settings?.name ?? process.env.INSTANCE_NAME ?? 'NexaHeart';
  const messages = tokens.map((t) => ({
    to: t.token,
    ...pushContent(job.kind, t.locale, instanceName),
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
  return 'sent';
}
