// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { refreshUpdateStatus, type UpdateSettings } from '@nexaheart/integrations';
import {
  ErrorCode,
  UPDATE_HISTORY_SIZE,
  UPDATE_SCHEDULE_MAX_DAYS,
  type UpdateChange,
  type UpdateRequest,
  type UpdateRequestStatus,
  type UpdateStatusView,
} from '@nexaheart/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

const { updateStatus, updateRequests } = schema;
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505');

/**
 * Updates from GitHub (phase 53). This service only reads the last check and records approvals:
 * it never runs anything on the server. scripts/update.sh does the install, outside the API.
 */
export class UpdateService {
  constructor(
    private readonly db: Database,
    private readonly settings: UpdateSettings,
    /** UPDATE_EMAILS=on: admins are emailed about new versions and results (phase 54). */
    private readonly emails = false,
  ) {}

  async status(): Promise<UpdateStatusView> {
    const [row] = await this.db.select().from(updateStatus).where(eq(updateStatus.id, 1));
    const [req] = await this.db
      .select()
      .from(updateRequests)
      .orderBy(desc(updateRequests.requestedAt))
      .limit(1);
    // Phase 56: the finished approvals, for the history (the latest is shown on its own above it).
    const history = await this.db
      .select()
      .from(updateRequests)
      .where(inArray(updateRequests.status, ['done', 'failed', 'cancelled']))
      .orderBy(desc(updateRequests.requestedAt))
      .limit(UPDATE_HISTORY_SIZE + 1);
    const current = this.settings.current ?? null;
    // A check made by an older image says nothing about this one, and nothing applies when the
    // running version isn't known.
    const sameVersion = Boolean(current) && row !== undefined && row.currentCommit === current;
    return {
      enabled: this.settings.enabled,
      emails: this.emails,
      repo: this.settings.repo,
      branch: this.settings.branch,
      current,
      checkedAt: row?.checkedAt.toISOString() ?? null,
      latest: sameVersion ? row!.latestCommit : null,
      latestAt: sameVersion ? (row!.latestAt?.toISOString() ?? null) : null,
      behind: sameVersion ? row!.behind : 0,
      changes: sameVersion ? (row!.changes as UpdateChange[]) : [],
      error: current ? (sameVersion ? row!.error : null) : 'unknown-version',
      request: req ? view(req) : null,
      history: history
        .filter((h) => h.id !== req?.id)
        .slice(0, UPDATE_HISTORY_SIZE)
        .map(view),
    };
  }

  /** "Check now": the same check the worker runs every 6 hours. */
  async check(): Promise<UpdateStatusView> {
    await refreshUpdateStatus(this.db, this.settings);
    return this.status();
  }

  /**
   * An admin approves installing the latest known commit. Only that commit, only when the server
   * is behind, and one at a time (a unique index keeps a second open request out).
   */
  async approve(adminId: string, commit: string, at?: string): Promise<UpdateStatusView> {
    // Phase 56: a chosen time, in the future (a minute of clock difference allowed) and at most
    // UPDATE_SCHEDULE_MAX_DAYS ahead. Absent: as soon as the server's updater sees it.
    const notBefore = at ? new Date(at) : null;
    if (notBefore) {
      const now = Date.now();
      if (notBefore.getTime() < now - 60_000) {
        throw new HttpError(400, ErrorCode.BadRequest, 'That time has already passed.');
      }
      if (notBefore.getTime() > now + UPDATE_SCHEDULE_MAX_DAYS * 86_400_000) {
        throw new HttpError(
          400,
          ErrorCode.BadRequest,
          `An update can be scheduled up to ${UPDATE_SCHEDULE_MAX_DAYS} days ahead.`,
        );
      }
    }
    const s = await this.status();
    if (!s.enabled) throw new HttpError(409, ErrorCode.Conflict, 'Update checks are turned off.');
    if (!s.current || !s.latest || s.behind === 0 || commit !== s.latest) {
      throw new HttpError(
        409,
        ErrorCode.Conflict,
        'That isn’t the update this server can install. Check again.',
      );
    }
    try {
      await this.db.transaction(async (tx) => {
        const [req] = await tx
          .insert(updateRequests)
          .values({ targetCommit: commit, fromCommit: s.current, requestedBy: adminId, notBefore })
          .returning({ id: updateRequests.id });
        await audit(tx, {
          actorId: adminId,
          action: 'update.approve',
          targetType: 'update',
          targetId: req!.id,
          meta: {
            from: s.current ?? '',
            to: commit,
            behind: s.behind,
            at: notBefore?.toISOString() ?? 'now',
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, ErrorCode.Conflict, 'An update is already waiting or running.');
      }
      throw error;
    }
    return this.status();
  }

  /** An approval the server hasn't started yet can be withdrawn. */
  async cancel(adminId: string, id: string): Promise<UpdateStatusView> {
    const [row] = await this.db
      .update(updateRequests)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(updateRequests.id, id), eq(updateRequests.status, 'pending')))
      .returning({ id: updateRequests.id });
    if (!row) throw new HttpError(409, ErrorCode.Conflict, 'This update has already started.');
    await audit(this.db, {
      actorId: adminId,
      action: 'update.cancel',
      targetType: 'update',
      targetId: id,
    });
    return this.status();
  }
}

function view(r: typeof updateRequests.$inferSelect): UpdateRequest {
  return {
    id: r.id,
    status: r.status as UpdateRequestStatus,
    target: r.targetCommit,
    from: r.fromCommit,
    requestedAt: r.requestedAt.toISOString(),
    notBefore: r.notBefore?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    message: r.message,
  };
}
