import { schema, type Database } from '@nexaheart/db';
import { AUDIT_LOG_RETENTION_DAYS, INACTIVITY_NOTICE_DAYS } from '@nexaheart/shared';
import type { Storage } from '@nexaheart/storage';
import { eq, inArray, sql } from 'drizzle-orm';

/** Housekeeping that limits how long personal data is kept (see docs/PRIVACY.md). */
export async function cleanupPrivacy(db: Database): Promise<{
  auditLogs: number;
  sessions: number;
  verificationTokens: number;
  rateLimits: number;
}> {
  const days = sql.raw(String(AUDIT_LOG_RETENTION_DAYS));
  const auditLogs = await db.execute(
    sql`DELETE FROM audit_logs WHERE created_at < now() - interval '${days} days'`,
  );
  const sessions = await db.execute(sql`DELETE FROM session WHERE expires_at < now()`);
  // Sessions created before IP/browser strings stopped being stored.
  await db.execute(
    sql`UPDATE session SET ip_address = NULL, user_agent = NULL WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL`,
  );
  const verificationTokens = await db.execute(
    sql`DELETE FROM verification WHERE expires_at < now()`,
  );
  // better-auth stores rate-limit counters with a millisecond timestamp.
  const rateLimits = await db.execute(
    sql`DELETE FROM rate_limit WHERE last_request < (extract(epoch FROM now()) * 1000 - 86400000)`,
  );
  return {
    auditLogs: auditLogs.rowCount ?? 0,
    sessions: sessions.rowCount ?? 0,
    verificationTokens: verificationTokens.rowCount ?? 0,
    rateLimits: rateLimits.rowCount ?? 0,
  };
}

export interface InactivityContext {
  db: Database;
  storage: Storage;
  /** 0 = off (default). Accounts with no sign-in activity for this many months are warned, then deleted. */
  months: number;
  instanceName: string;
  sendMail: (to: string, subject: string, text: string) => Promise<void>;
}

/**
 * Optional storage limitation for abandoned accounts ⚖️: an email warning first, deletion after
 * INACTIVITY_NOTICE_DAYS unless the person signs in. Staff accounts are never included.
 */
export async function handleInactiveAccounts(
  ctx: InactivityContext,
): Promise<{ warned: number; deleted: number; returned: number }> {
  if (ctx.months <= 0) return { warned: 0, deleted: 0, returned: 0 };
  const months = sql.raw(String(Math.floor(ctx.months)));
  const noticeDays = sql.raw(String(INACTIVITY_NOTICE_DAYS));
  const lastActive = sql`u.last_seen_at`;

  // People who came back after the warning (the sign-in hook clears it too; this is a safety net).
  const returned = await ctx.db.execute(sql`
    UPDATE "user" u SET inactivity_notice_at = NULL
    WHERE u.inactivity_notice_at IS NOT NULL AND ${lastActive} > u.inactivity_notice_at`);

  const toDelete = await ctx.db.execute<{ id: string }>(sql`
    SELECT u.id FROM "user" u
    WHERE u.role = 'user' AND u.inactivity_notice_at < now() - interval '${noticeDays} days'
      AND ${lastActive} <= u.inactivity_notice_at`);
  for (const { id } of toDelete.rows) await deleteAccount(ctx, id);

  const toWarn = await ctx.db.execute<{ id: string; email: string }>(sql`
    SELECT u.id, u.email FROM "user" u
    WHERE u.role = 'user' AND u.inactivity_notice_at IS NULL
      AND ${lastActive} < now() - interval '${months} months'
    LIMIT 500`);
  const deadline = new Date(Date.now() + INACTIVITY_NOTICE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let warned = 0;
  for (const row of toWarn.rows) {
    await ctx.sendMail(
      row.email,
      `${ctx.instanceName}: your account will be deleted on ${deadline}`,
      `Your ${ctx.instanceName} account has not been used for ${ctx.months} months.\n\n` +
        `To keep it, simply sign in before ${deadline}. Otherwise your account and all its data ` +
        'will be deleted on that date.\n\n' +
        'Want a copy first? Sign in and choose Settings → Download my data.\n',
    );
    await ctx.db
      .update(schema.user)
      .set({ inactivityNoticeAt: new Date() })
      .where(eq(schema.user.id, row.id));
    warned += 1;
  }
  return { warned, deleted: toDelete.rows.length, returned: returned.rowCount ?? 0 };
}

async function deleteAccount(ctx: InactivityContext, userId: string): Promise<void> {
  const { photos, audioClips, auditLogs, user } = schema;
  const files = [
    ...(await ctx.db
      .select({ q: photos.quarantineKey, m: photos.mediaKey, o: sql<string | null>`NULL` })
      .from(photos)
      .where(eq(photos.userId, userId))),
    ...(await ctx.db
      .select({ q: audioClips.quarantineKey, m: audioClips.mediaKey, o: audioClips.opusKey })
      .from(audioClips)
      .where(eq(audioClips.userId, userId))),
  ];
  await ctx.db.transaction(async (tx) => {
    await tx.delete(user).where(inArray(user.id, [userId]));
    await tx.insert(auditLogs).values({
      actorId: null,
      action: 'account.deleted_inactive',
      targetType: 'user',
      targetId: userId,
    });
  });
  await ctx.storage.delete(
    ctx.storage.buckets.quarantine,
    files.flatMap((f) => (f.q ? [f.q] : [])),
  );
  await ctx.storage.delete(
    ctx.storage.buckets.media,
    files.flatMap((f) => [f.m, f.o].filter((k): k is string => Boolean(k))),
  );
}
