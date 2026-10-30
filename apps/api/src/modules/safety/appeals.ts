// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  appealableActions,
  appealDeadline,
  ErrorCode,
  MODERATION_LOG_RETENTION_DAYS,
  type AppealSummary,
  type Decision,
} from '@nexaheart/shared';
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { audit } from '../../lib/audit.js';
import { appealDecidedEmail, type Mailer } from '../../lib/mailer.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AuthUser } from '../../auth/session.js';
import { liftModeration } from '../admin/moderation.js';

const { moderationLog, moderationAppeals, user, profiles } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const conflict = (message: string) => new HttpError(409, ErrorCode.Conflict, message);
const forbidden = (message: string) => new HttpError(403, ErrorCode.Forbidden, message);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Phase 61: the statement of reasons a member reads about each decision on their account, and
 * the appeals against them (DSA Art. 17 and 20 ⚖️). People decide every appeal.
 */
export class AppealService {
  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly instanceName: string,
    private readonly onMailError: (error: unknown) => void,
  ) {}

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------

  async decisions(userId: string, now = new Date()): Promise<Decision[]> {
    const rows = await this.db
      .select({ decision: moderationLog, appeal: moderationAppeals })
      .from(moderationLog)
      .leftJoin(moderationAppeals, eq(moderationAppeals.decisionId, moderationLog.id))
      .where(
        and(
          eq(moderationLog.targetId, userId),
          inArray(moderationLog.action, [...appealableActions]),
          gt(
            moderationLog.createdAt,
            new Date(now.getTime() - MODERATION_LOG_RETENTION_DAYS * DAY_MS),
          ),
        ),
      )
      .orderBy(desc(moderationLog.createdAt));
    return rows.map(({ decision: d, appeal: a }) => {
      const until = appealDeadline(d.createdAt);
      return {
        id: d.id,
        action: d.action as Decision['action'],
        category: d.category,
        ground: d.ground,
        explanation: d.explanation,
        automatedDetection: d.automatedDetection,
        createdAt: d.createdAt.toISOString(),
        reversed: d.reversedAt !== null,
        appealUntil: until.toISOString(),
        canAppeal: !a && d.reversedAt === null && now <= until,
        appeal: a
          ? {
              status: a.status,
              createdAt: a.createdAt.toISOString(),
              decidedAt: a.decidedAt?.toISOString() ?? null,
              response: a.response,
            }
          : null,
      };
    });
  }

  async appeal(userId: string, decisionId: string, text: string, now = new Date()): Promise<void> {
    const [decision] = await this.db
      .select({ action: moderationLog.action, createdAt: moderationLog.createdAt })
      .from(moderationLog)
      .where(
        and(
          eq(moderationLog.id, decisionId),
          eq(moderationLog.targetId, userId),
          inArray(moderationLog.action, [...appealableActions]),
          isNull(moderationLog.reversedAt),
        ),
      );
    if (!decision) throw notFound();
    if (now > appealDeadline(decision.createdAt)) {
      throw conflict('The time to appeal this decision has passed.');
    }
    const inserted = await this.db
      .insert(moderationAppeals)
      .values({ decisionId, userId, text })
      .onConflictDoNothing()
      .returning({ id: moderationAppeals.id });
    if (inserted.length === 0) throw conflict('This decision was already appealed.');
    await audit(this.db, {
      actorId: userId,
      action: 'appeal.created',
      targetType: 'appeal',
      targetId: inserted[0]!.id,
      meta: { action: decision.action },
    });
    await this.alertStaff();
  }

  // -------------------------------------------------------------------------
  // Staff
  // -------------------------------------------------------------------------

  async queue(staff: AuthUser, status: 'open' | 'closed'): Promise<AppealSummary[]> {
    const staffProfile = alias(profiles, 'staff_profile');
    const rows = await this.db
      .select({
        appeal: moderationAppeals,
        decision: moderationLog,
        displayName: profiles.displayName,
        memberStatus: user.status,
        staffName: staffProfile.displayName,
      })
      .from(moderationAppeals)
      .innerJoin(moderationLog, eq(moderationLog.id, moderationAppeals.decisionId))
      .innerJoin(user, eq(user.id, moderationAppeals.userId))
      .leftJoin(profiles, eq(profiles.userId, moderationAppeals.userId))
      .leftJoin(staffProfile, eq(staffProfile.userId, moderationLog.staffId))
      .where(
        status === 'open'
          ? eq(moderationAppeals.status, 'open')
          : ne(moderationAppeals.status, 'open'),
      )
      .orderBy(
        status === 'open' ? asc(moderationAppeals.createdAt) : desc(moderationAppeals.decidedAt),
      )
      .limit(200);
    const soleAdmin = await this.isSoleAdmin(staff);
    return rows.map(({ appeal: a, decision: d, displayName, memberStatus, staffName }) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      text: a.text,
      member: { id: a.userId, displayName, status: memberStatus },
      decision: {
        id: d.id,
        action: d.action as AppealSummary['decision']['action'],
        category: d.category,
        ground: d.ground,
        explanation: d.explanation,
        reason: d.reason,
        automatedDetection: d.automatedDetection,
        staffName,
        reportId: d.reportId,
        createdAt: d.createdAt.toISOString(),
      },
      canDecide:
        a.status === 'open' &&
        this.mayDecide(staff, a.userId, d.action, d.staffId, soleAdmin) === null,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      response: a.response,
    }));
  }

  async decide(
    staff: AuthUser,
    appealId: string,
    reverse: boolean,
    response: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ appeal: moderationAppeals, decision: moderationLog, email: user.email })
      .from(moderationAppeals)
      .innerJoin(moderationLog, eq(moderationLog.id, moderationAppeals.decisionId))
      .innerJoin(user, eq(user.id, moderationAppeals.userId))
      .where(eq(moderationAppeals.id, appealId));
    if (!row) throw notFound();
    const { appeal, decision } = row;
    if (appeal.status !== 'open') throw conflict('This appeal was already decided.');
    const refusal = this.mayDecide(
      staff,
      appeal.userId,
      decision.action,
      decision.staffId,
      await this.isSoleAdmin(staff),
    );
    if (refusal) throw forbidden(refusal);

    await this.db.transaction(async (tx) => {
      const now = new Date();
      const updated = await tx
        .update(moderationAppeals)
        .set({
          status: reverse ? 'reversed' : 'upheld',
          reviewerId: staff.id,
          response,
          decidedAt: now,
        })
        .where(and(eq(moderationAppeals.id, appealId), eq(moderationAppeals.status, 'open')))
        .returning({ id: moderationAppeals.id });
      if (updated.length === 0) throw conflict('This appeal was already decided.');
      if (reverse) {
        await tx
          .update(moderationLog)
          .set({ reversedAt: now })
          .where(eq(moderationLog.id, decision.id));
        if (decision.action !== 'warn' && (await this.isCurrentRestriction(tx, decision.id))) {
          await liftModeration(tx, staff.id, appeal.userId, 'Appeal accepted');
        }
      }
      await audit(tx, {
        actorId: staff.id,
        action: reverse ? 'appeal.reversed' : 'appeal.upheld',
        targetType: 'user',
        targetId: appeal.userId,
        meta: { appeal: appealId, action: decision.action },
      });
    });

    this.mailer
      .send({ to: row.email, ...appealDecidedEmail(this.instanceName) })
      .catch(this.onMailError);
  }

  /**
   * Why this staff member may not decide this appeal, or null. Never one's own account; not the
   * person who took the decision, unless they are the community's only admin (a community of one
   * would otherwise have no way to answer); suspensions and bans by admins only.
   */
  private mayDecide(
    staff: AuthUser,
    memberId: string,
    action: string,
    deciderId: string | null,
    soleAdmin: boolean,
  ): string | null {
    if (staff.id === memberId) return 'You cannot decide an appeal about your own account.';
    if (action !== 'warn' && staff.role !== 'admin') {
      return 'Only admins can decide appeals about suspensions and bans.';
    }
    if (deciderId === staff.id && !soleAdmin) {
      return 'Another staff member should review a decision you took.';
    }
    return null;
  }

  private async isSoleAdmin(staff: AuthUser): Promise<boolean> {
    if (staff.role !== 'admin') return false;
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(user)
      .where(and(eq(user.role, 'admin'), eq(user.status, 'active')));
    return (row?.n ?? 0) <= 1;
  }

  /** The member's latest suspension or ban is this decision (a later one stays in force). */
  private async isCurrentRestriction(
    tx: Pick<Database, 'select'>,
    decisionId: string,
  ): Promise<boolean> {
    const [target] = await tx
      .select({ targetId: moderationLog.targetId })
      .from(moderationLog)
      .where(eq(moderationLog.id, decisionId));
    if (!target) return false;
    const [latest] = await tx
      .select({ id: moderationLog.id })
      .from(moderationLog)
      .where(
        and(
          eq(moderationLog.targetId, target.targetId),
          or(
            eq(moderationLog.action, 'suspend'),
            eq(moderationLog.action, 'ban'),
            eq(moderationLog.action, 'unsuspend'),
          ),
        ),
      )
      .orderBy(desc(moderationLog.createdAt))
      .limit(1);
    const [account] = await tx
      .select({ status: user.status, reason: user.suspendedReason })
      .from(user)
      .where(eq(user.id, target.targetId));
    return (
      latest?.id === decisionId &&
      account?.status === 'suspended' &&
      (account.reason === 'moderation' || account.reason === 'banned')
    );
  }

  /** Tells staff that an appeal is waiting. The email carries no content. */
  private async alertStaff(): Promise<void> {
    const staff = await this.db
      .select({ email: user.email })
      .from(user)
      .where(
        and(
          or(eq(user.role, 'moderator'), eq(user.role, 'admin')),
          eq(user.status, 'active'),
          sql`EXISTS (SELECT 1 FROM staff_mfa m WHERE m.user_id = ${user.id} AND m.enabled_at IS NOT NULL)`,
        ),
      );
    for (const { email } of staff) {
      this.mailer
        .send({
          to: email,
          subject: `${this.instanceName}: an appeal is waiting`,
          text: `A member appealed a moderation decision in ${this.instanceName}.\n\nOpen the moderation dashboard (Appeals) to review it. The appeal is only available there.`,
          html: '<p>A member appealed a moderation decision.</p><p>Open the moderation dashboard (Appeals) to review it. The appeal is only available there.</p>',
        })
        .catch(this.onMailError);
    }
  }
}
