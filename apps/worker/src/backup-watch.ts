// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { BACKUP_STALE_HOURS, backupAlertEmail } from '@nexaheart/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

const { maintenanceRuns } = schema;

/** A new server gets this long to record its first backup before anyone is told. */
export const FIRST_BACKUP_GRACE_HOURS = 48;
/** At most one alert in this time, however often the job runs. */
export const BACKUP_ALERT_EVERY_HOURS = 20;

export interface BackupWatchContext {
  db: Database;
  instanceName: () => Promise<string>;
  /** The dashboard's address; the email links to its System page. */
  adminUrl: string;
  sendMail: (message: { to: string; subject: string; text: string; html: string }) => Promise<void>;
  /** The team's alert channel (phase 24), when it's set up: one short line. */
  alert?: (text: string) => Promise<void>;
  now?: () => Date;
}

export type BackupWatchResult =
  { state: 'fresh' | 'new-server' | 'already-told' } | { state: 'alerted'; emailed: number };

/**
 * Daily (phase 52): when backups have stopped (none for BACKUP_STALE_HOURS, or never on a server
 * older than FIRST_BACKUP_GRACE_HOURS), email every admin and post to the alert channel. Recorded
 * as a `backup-alert` run, so a repeat within BACKUP_ALERT_EVERY_HOURS sends nothing.
 */
export async function processBackupWatch(ctx: BackupWatchContext): Promise<BackupWatchResult> {
  const now = ctx.now?.() ?? new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  const [last] = await ctx.db
    .select({ finishedAt: maintenanceRuns.finishedAt })
    .from(maintenanceRuns)
    .where(eq(maintenanceRuns.kind, 'backup'))
    .orderBy(desc(maintenanceRuns.finishedAt))
    .limit(1);
  if (last && last.finishedAt > hoursAgo(BACKUP_STALE_HOURS)) return { state: 'fresh' };
  if (!last) {
    const { rows } = await ctx.db.execute<{ since: Date | null }>(
      sql`SELECT min(created_at) AS since FROM "user"`,
    );
    const since = rows[0]?.since ? new Date(rows[0].since) : null;
    if (!since || since > hoursAgo(FIRST_BACKUP_GRACE_HOURS)) return { state: 'new-server' };
  }
  const [told] = await ctx.db
    .select({ id: maintenanceRuns.id })
    .from(maintenanceRuns)
    .where(
      and(
        eq(maintenanceRuns.kind, 'backup-alert'),
        gt(maintenanceRuns.finishedAt, hoursAgo(BACKUP_ALERT_EVERY_HOURS)),
      ),
    )
    .limit(1);
  if (told) return { state: 'already-told' };

  // Recorded first: a mail server that fails half-way doesn't turn into an email every run.
  await ctx.db.insert(maintenanceRuns).values({ kind: 'backup-alert', finishedAt: now });
  const instanceName = await ctx.instanceName();
  const systemUrl = `${ctx.adminUrl.replace(/\/$/, '')}/#/system`;
  const mail = backupAlertEmail({ instanceName, lastAt: last?.finishedAt ?? null, systemUrl });
  const admins = await ctx.db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(and(eq(schema.user.role, 'admin'), eq(schema.user.status, 'active')));
  let emailed = 0;
  for (const { email } of admins) {
    try {
      await ctx.sendMail({ to: email, ...mail });
      emailed += 1;
    } catch {
      // One address failing doesn't stop the others; the job's result shows how many went out.
    }
  }
  await ctx
    .alert?.(`⚠️ ${instanceName}: no backup recorded recently. ${systemUrl}`)
    .catch(() => undefined);
  return { state: 'alerted', emailed };
}
