import { schema, type Database } from '@nexaheart/db';
import {
  CHECKIN_GRACE_MINUTES,
  CHECKIN_RETENTION_DAYS,
  checkinAlertEmail,
  type Locale,
} from '@nexaheart/shared';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';

const { checkins, profiles } = schema;

export interface CheckinContext {
  db: Database;
  instanceName: () => Promise<string>;
  sendMail: (message: { to: string; subject: string; text: string; html: string }) => Promise<void>;
  /** Reminds the member on their phone (best effort). */
  remind: (userId: string, checkinId: string) => Promise<void>;
  now?: () => Date;
}

/**
 * Runs every minute: reminds the member at the check-in time, emails the trusted contact
 * CHECKIN_GRACE_MINUTES later if the member still hasn't confirmed, and deletes old check-ins.
 * Each alert is sent once: the row is locked, emailed, then marked in the same transaction, so a
 * failed send is retried next minute and a second worker skips locked rows.
 */
export async function processCheckins(
  ctx: CheckinContext,
): Promise<{ reminded: number; alerted: number; deleted: number }> {
  const now = ctx.now?.() ?? new Date();

  const due = await ctx.db
    .update(checkins)
    .set({ remindedAt: now })
    .where(
      and(eq(checkins.status, 'active'), isNull(checkins.remindedAt), lte(checkins.checkAt, now)),
    )
    .returning({ id: checkins.id, userId: checkins.userId });
  for (const row of due) await ctx.remind(row.userId, row.id).catch(() => undefined);

  const deadline = new Date(now.getTime() - CHECKIN_GRACE_MINUTES * 60_000);
  let alerted = 0;
  const instanceName = await ctx.instanceName();
  for (;;) {
    const sent = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(checkins)
        .where(and(eq(checkins.status, 'active'), lte(checkins.checkAt, deadline)))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return false;
      const [member] = await tx
        .select({ name: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.userId, row.userId));
      await ctx.sendMail({
        to: row.contactEmail,
        ...checkinAlertEmail({
          instanceName,
          memberName: member?.name ?? '?',
          contactName: row.contactName,
          matchName: row.matchName,
          place: row.place,
          note: row.note,
          startsAt: row.startsAt,
          checkAt: row.checkAt,
          locale: row.locale as Locale,
          timeZone: row.timeZone,
          sos: false,
        }),
      });
      await tx
        .update(checkins)
        .set({ status: 'alerted', alertedAt: now })
        .where(eq(checkins.id, row.id));
      return true;
    });
    if (!sent) break;
    alerted += 1;
  }

  const days = sql.raw(String(CHECKIN_RETENTION_DAYS));
  const deleted = await ctx.db.execute(sql`
    DELETE FROM checkins
    WHERE ended_at < now() - interval '${days} days'
       OR check_at < now() - interval '${days} days'`);
  return { reminded: due.length, alerted, deleted: deleted.rowCount ?? 0 };
}
