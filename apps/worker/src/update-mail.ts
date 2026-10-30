// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { updateAvailableEmail, updateResultEmail, type UpdateChange } from '@nexaheart/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

const { updateStatus, updateRequests } = schema;

/** A busy update branch gives one "update available" email in this time, not one per merge. */
export const UPDATE_NOTICE_EVERY_HOURS = 20;

type Mail = { to: string; subject: string; text: string; html: string };

export interface UpdateMailContext {
  db: Database;
  instanceName: () => Promise<string>;
  /** The dashboard's address; the emails link to its System page. */
  adminUrl: string;
  /** UPDATE_REPO, for links to the pull requests. */
  repo: string;
  /** The commit this server runs (APP_COMMIT): a check made by another version says nothing. */
  current: string | undefined;
  sendMail: (message: Mail) => Promise<void>;
  now?: () => Date;
}

export type UpdateNoticeResult =
  { state: 'up-to-date' | 'already-told' | 'approved' } | { state: 'notified'; emailed: number };

const systemUrl = (adminUrl: string) => `${adminUrl.replace(/\/$/, '')}/#/system`;

/** Every active admin; one address failing doesn't stop the others. */
async function mailAdmins(db: Database, send: (to: string) => Promise<void>): Promise<number> {
  const admins = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(and(eq(schema.user.role, 'admin'), eq(schema.user.status, 'active')));
  let emailed = 0;
  for (const { email } of admins) {
    try {
      await send(email);
      emailed += 1;
    } catch {
      // Counted in the job's result.
    }
  }
  return emailed;
}

/**
 * Phase 54, after each update check: when this server is behind a commit the admins weren't told
 * about yet, email them what was added or fixed. At most once per UPDATE_NOTICE_EVERY_HOURS, and
 * not while an update is already approved or running.
 */
export async function processUpdateNotice(ctx: UpdateMailContext): Promise<UpdateNoticeResult> {
  const now = ctx.now?.() ?? new Date();
  const [row] = await ctx.db.select().from(updateStatus).where(eq(updateStatus.id, 1));
  if (
    !ctx.current ||
    !row ||
    row.currentCommit !== ctx.current ||
    !row.latestCommit ||
    row.behind <= 0
  ) {
    return { state: 'up-to-date' };
  }
  if (row.notifiedCommit === row.latestCommit) return { state: 'already-told' };
  if (
    row.notifiedAt &&
    row.notifiedAt.getTime() > now.getTime() - UPDATE_NOTICE_EVERY_HOURS * 3_600_000
  ) {
    return { state: 'already-told' };
  }
  const [open] = await ctx.db
    .select({ id: updateRequests.id })
    .from(updateRequests)
    .where(inArray(updateRequests.status, ['pending', 'running']))
    .limit(1);
  if (open) return { state: 'approved' };

  // Recorded first, and only if nobody else did meanwhile: a mail server failing half-way
  // doesn't turn into an email every run.
  const claimed = await ctx.db
    .update(updateStatus)
    .set({ notifiedCommit: row.latestCommit, notifiedAt: now })
    .where(
      and(
        eq(updateStatus.id, 1),
        sql`${updateStatus.notifiedCommit} IS DISTINCT FROM ${row.latestCommit}`,
      ),
    )
    .returning({ id: updateStatus.id });
  if (claimed.length === 0) return { state: 'already-told' };

  const mail = updateAvailableEmail({
    instanceName: await ctx.instanceName(),
    changes: row.changes as UpdateChange[],
    behind: row.behind,
    repo: ctx.repo,
    systemUrl: systemUrl(ctx.adminUrl),
  });
  const emailed = await mailAdmins(ctx.db, (to) => ctx.sendMail({ to, ...mail }));
  return { state: 'notified', emailed };
}

/**
 * Phase 54, every 2 minutes: an approved update that finished (installed or failed) is emailed to
 * the admins once. A withdrawn one isn't.
 */
export async function processUpdateResults(
  ctx: Omit<UpdateMailContext, 'repo' | 'current'>,
): Promise<{ results: number; emailed: number }> {
  const now = ctx.now?.() ?? new Date();
  // Claimed in one statement: two workers never mail the same result.
  const finished = await ctx.db
    .update(updateRequests)
    .set({ notifiedAt: now })
    .where(
      and(isNull(updateRequests.notifiedAt), inArray(updateRequests.status, ['done', 'failed'])),
    )
    .returning({ status: updateRequests.status, message: updateRequests.message });
  if (finished.length === 0) return { results: 0, emailed: 0 };
  const instanceName = await ctx.instanceName();
  let emailed = 0;
  for (const r of finished) {
    const mail = updateResultEmail({
      instanceName,
      status: r.status === 'done' ? 'done' : 'failed',
      message: r.message,
      systemUrl: systemUrl(ctx.adminUrl),
    });
    emailed += await mailAdmins(ctx.db, (to) => ctx.sendMail({ to, ...mail }));
  }
  return { results: finished.length, emailed };
}
