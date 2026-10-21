import { schema, type Database } from '@dateos/db';
import {
  ageOn,
  ErrorCode,
  type AuditEntry,
  type ModerationAction,
  type ReportDetail,
  type ReportSummary,
} from '@dateos/shared';
import { and, asc, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import type { EmailHasher } from '../../lib/banned.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AuthUser } from '../../auth/session.js';
import type { DiscoveryService } from '../discovery/service.js';

const {
  reports,
  reportEvidence,
  moderationLog,
  bannedEmails,
  user,
  session,
  profiles,
  prompts,
  photos,
  auditLogs,
} = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const forbidden = (message: string) => new HttpError(403, ErrorCode.Forbidden, message);

const priorityOrder = sql`CASE ${reports.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`;

export class ModerationService {
  constructor(
    private readonly db: Database,
    private readonly discovery: DiscoveryService,
    private readonly hashEmail: EmailHasher,
    private readonly today: () => string,
  ) {}

  queue(status: 'open' | 'closed'): Promise<ReportSummary[]> {
    return status === 'open'
      ? this.summaries(eq(reports.status, 'open'), [priorityOrder, asc(reports.createdAt)])
      : this.summaries(sql`${reports.status} <> 'open'`, [desc(reports.resolvedAt)]);
  }

  private async summaries(where: SQL | undefined, order: SQL[]): Promise<ReportSummary[]> {
    const rows = await this.db
      .select({
        id: reports.id,
        category: reports.category,
        priority: reports.priority,
        status: reports.status,
        createdAt: reports.createdAt,
        reportedId: reports.reportedId,
        displayName: profiles.displayName,
        reportedStatus: user.status,
        openAgainst: sql<number>`(SELECT count(*)::int FROM reports r2 WHERE r2.reported_id = ${reports.reportedId} AND r2.status = 'open')`,
        evidenceCount: sql<number>`(SELECT count(*)::int FROM report_evidence e WHERE e.report_id = ${reports.id})`,
      })
      .from(reports)
      .innerJoin(user, eq(user.id, reports.reportedId))
      .leftJoin(profiles, eq(profiles.userId, reports.reportedId))
      .where(where)
      .orderBy(...order)
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      priority: r.priority,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reported: { id: r.reportedId, displayName: r.displayName, status: r.reportedStatus },
      openReportsAgainst: r.openAgainst,
      evidenceCount: r.evidenceCount,
    }));
  }

  async detail(staff: AuthUser, reportId: string): Promise<ReportDetail> {
    const [summary] = await this.summaries(eq(reports.id, reportId), []);
    if (!summary) throw notFound();
    const [report] = await this.db.select().from(reports).where(eq(reports.id, reportId));
    const reporterName = report!.reporterId
      ? ((
          await this.db
            .select({ name: profiles.displayName })
            .from(profiles)
            .where(eq(profiles.userId, report!.reporterId))
        )[0]?.name ?? null)
      : null;
    const evidence = await this.db
      .select()
      .from(reportEvidence)
      .where(eq(reportEvidence.reportId, reportId))
      .orderBy(asc(reportEvidence.sentAt));
    const [target] = await this.db
      .select({ role: user.role, createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, report!.reportedId));
    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, report!.reportedId));
    const promptRows = await this.db
      .select({ promptKey: prompts.promptKey, answer: prompts.answer })
      .from(prompts)
      .where(eq(prompts.userId, report!.reportedId))
      .orderBy(asc(prompts.position));
    const photoRows = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(
        and(
          eq(photos.userId, report!.reportedId),
          eq(photos.purpose, 'profile'),
          eq(photos.status, 'clean'),
        ),
      )
      .orderBy(asc(photos.position));
    const history = await this.db
      .select({
        action: moderationLog.action,
        category: moderationLog.category,
        reason: moderationLog.reason,
        createdAt: moderationLog.createdAt,
        staffName: profiles.displayName,
      })
      .from(moderationLog)
      .leftJoin(profiles, eq(profiles.userId, moderationLog.staffId))
      .where(eq(moderationLog.targetId, report!.reportedId))
      .orderBy(desc(moderationLog.createdAt));

    // Every staff read of a report (and the private chat excerpts in it) is recorded.
    await audit(this.db, {
      actorId: staff.id,
      action: 'staff.report_viewed',
      targetType: 'report',
      targetId: reportId,
    });

    return {
      ...summary,
      details: report!.details,
      reporter: { id: report!.reporterId, displayName: reporterName },
      evidence: evidence.map((e) => ({
        from: e.fromReported ? ('reported' as const) : ('reporter' as const),
        body: e.body,
        flags: e.flags,
        sentAt: e.sentAt.toISOString(),
      })),
      resolution:
        report!.resolvedAction && report!.resolvedAt && report!.resolvedAction !== 'unsuspend'
          ? {
              action: report!.resolvedAction,
              reason: report!.resolvedReason ?? '',
              resolvedAt: report!.resolvedAt.toISOString(),
            }
          : null,
      reportedProfile: profile
        ? {
            age: ageOn(profile.birthDate, this.today()),
            gender: profile.gender,
            bio: profile.bio,
            prompts: promptRows,
            photoIds: photoRows.map((p) => p.id),
            verified: profile.verifiedAt !== null,
            memberSince: target!.createdAt.toISOString(),
            role: target!.role,
          }
        : null,
      history: history.map((h) => ({
        action: h.action,
        category: h.category,
        reason: h.reason,
        staffName: h.staffName,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  async resolve(
    staff: AuthUser,
    reportId: string,
    action: ModerationAction,
    reason: string,
  ): Promise<void> {
    const [report] = await this.db.select().from(reports).where(eq(reports.id, reportId));
    if (!report) throw notFound();
    if (report.status !== 'open') {
      throw new HttpError(409, ErrorCode.Conflict, 'This report was already handled.');
    }
    if (report.reportedId === staff.id || report.reporterId === staff.id) {
      throw forbidden('You cannot handle a report that involves you.');
    }
    const [target] = await this.db
      .select({ role: user.role, email: user.email })
      .from(user)
      .where(eq(user.id, report.reportedId));
    if (!target) throw notFound();
    if (action !== 'dismiss' && target.role !== 'user') {
      throw forbidden('Staff accounts are managed by operators, not through reports.');
    }
    if (action === 'ban' && staff.role !== 'admin') throw forbidden('Only admins can ban.');

    const removesAccess = action === 'suspend' || action === 'ban';
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const resolution = {
        status: action === 'dismiss' ? ('dismissed' as const) : ('actioned' as const),
        resolvedBy: staff.id,
        resolvedAction: action,
        resolvedReason: reason,
        resolvedAt: now,
      };
      // Suspending or banning settles every open report against the same member.
      await tx
        .update(reports)
        .set(resolution)
        .where(
          removesAccess
            ? and(eq(reports.reportedId, report.reportedId), eq(reports.status, 'open'))
            : eq(reports.id, reportId),
        );
      if (action !== 'dismiss') {
        await tx.insert(moderationLog).values({
          targetId: report.reportedId,
          staffId: staff.id,
          reportId,
          action,
          category: report.category,
          reason,
        });
      }
      if (removesAccess) {
        await tx
          .update(user)
          .set({ status: 'suspended', suspendedReason: action === 'ban' ? 'banned' : 'moderation' })
          .where(eq(user.id, report.reportedId));
        await tx.delete(session).where(eq(session.userId, report.reportedId));
      }
      if (action === 'ban') {
        await tx
          .insert(bannedEmails)
          .values({ emailHash: this.hashEmail(target.email), userId: report.reportedId })
          .onConflictDoNothing();
      }
      await audit(tx, {
        actorId: staff.id,
        action: `moderation.${action}`,
        targetType: 'user',
        targetId: report.reportedId,
        meta: { report: reportId, category: report.category },
      });
    });
    if (removesAccess) await this.discovery.closeAllMatches(report.reportedId);
  }

  /** Admins only. Lifts a moderation suspension or ban (never an age-related suspension). */
  async liftSuspension(staff: AuthUser, userId: string, reason: string): Promise<void> {
    if (staff.role !== 'admin') throw forbidden('Only admins can lift a suspension.');
    const [target] = await this.db
      .select({ status: user.status, reason: user.suspendedReason })
      .from(user)
      .where(eq(user.id, userId));
    if (!target) throw notFound();
    if (
      target.status !== 'suspended' ||
      (target.reason !== 'moderation' && target.reason !== 'banned')
    ) {
      throw new HttpError(409, ErrorCode.Conflict, 'This account has no moderation suspension.');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ status: 'active', suspendedReason: null })
        .where(eq(user.id, userId));
      await tx.delete(bannedEmails).where(eq(bannedEmails.userId, userId));
      await tx
        .insert(moderationLog)
        .values({ targetId: userId, staffId: staff.id, action: 'unsuspend', reason });
      await audit(tx, {
        actorId: staff.id,
        action: 'moderation.unsuspend',
        targetType: 'user',
        targetId: userId,
      });
    });
  }

  async auditLog(before: string | undefined, limit: number): Promise<AuditEntry[]> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(before ? lt(auditLogs.createdAt, new Date(before)) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actorId,
      targetType: r.targetType,
      targetId: r.targetId,
      meta: r.meta,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Staff view of a reported member's profile photo (audited). */
  async recordPhotoView(staff: AuthUser, userId: string, photoId: string): Promise<void> {
    await audit(this.db, {
      actorId: staff.id,
      action: 'staff.photo_viewed',
      targetType: 'photo',
      targetId: photoId,
      meta: { owner: userId },
    });
  }
}
