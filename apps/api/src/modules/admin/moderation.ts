// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  ageOn,
  BACKUP_STALE_HOURS,
  ErrorCode,
  FEDERATION_SIGNALS_PATH,
  FEDERATION_SIGNALS_REVOKE_PATH,
  MAX_SIGNAL_HASHES,
  STAFF_ACCESS_ACTIONS,
  type SystemStatus,
  type AuditEntry,
  type ModerationAction,
  type ModerationGround,
  type ReportDetail,
  type ReportSummary,
} from '@nexaheart/shared';
import { and, asc, desc, eq, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import type { EmailHasher } from '../../lib/banned.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AuthUser } from '../../auth/session.js';
import type { DiscoveryService } from '../discovery/service.js';
import type { AppEvents } from '../../lib/app-events.js';
import { noEvents } from '../../lib/app-events.js';
import { safetyOverview } from './overview.js';
import type { SafetyOverview } from '@nexaheart/shared';

const {
  reports,
  reportEvidence,
  moderationLog,
  bannedEmails,
  bannedPhotoHashes,
  user,
  session,
  profiles,
  prompts,
  photos,
  auditLogs,
} = schema;

type Tx = Pick<Database, 'insert' | 'update' | 'delete' | 'execute'>;

/**
 * Lifts a moderation suspension or ban, inside the caller's transaction: by an admin from the
 * dashboard, or when an appeal is upheld (phase 61). The caller checks the account's state.
 */
export async function liftModeration(
  tx: Tx,
  staffId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await tx.update(user).set({ status: 'active', suspendedReason: null }).where(eq(user.id, userId));
  await tx.delete(bannedEmails).where(eq(bannedEmails.userId, userId));
  await tx.delete(bannedPhotoHashes).where(eq(bannedPhotoHashes.userId, userId));
  // Phase 73b: withdraw the trust signals sent about them, from every partner.
  await tx.execute(sql`
    INSERT INTO federation_outbox (partner_id, path, payload)
    SELECT p.id, ${FEDERATION_SIGNALS_REVOKE_PATH}, jsonb_build_object('id', s.id)
    FROM federation_signals_out s, federation_partners p
    WHERE s.user_id = ${userId} AND p.status IN ('active', 'suspended')`);
  await tx.execute(sql`DELETE FROM federation_signals_out WHERE user_id = ${userId}`);
  await tx.insert(moderationLog).values({ targetId: userId, staffId, action: 'unsuspend', reason });
  await audit(tx, {
    actorId: staffId,
    action: 'moderation.unsuspend',
    targetType: 'user',
    targetId: userId,
  });
}

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

  /** Dashboard → Overview (phase 36): counts only. */
  /** The last backup scripts/backup.sh recorded (phase 51). */
  async lastBackup(now = new Date()): Promise<SystemStatus['backup']> {
    const [row] = await this.db
      .select({
        finishedAt: schema.maintenanceRuns.finishedAt,
        bytes: schema.maintenanceRuns.bytes,
      })
      .from(schema.maintenanceRuns)
      .where(eq(schema.maintenanceRuns.kind, 'backup'))
      .orderBy(desc(schema.maintenanceRuns.finishedAt))
      .limit(1);
    if (!row) return { lastAt: null, bytes: null, stale: true };
    const ageHours = (now.getTime() - row.finishedAt.getTime()) / 3_600_000;
    return {
      lastAt: row.finishedAt.toISOString(),
      bytes: row.bytes,
      stale: ageHours > BACKUP_STALE_HOURS,
    };
  }

  overview(): Promise<SafetyOverview> {
    return safetyOverview(this.db);
  }

  /** Integrations listen here (phase 24). */
  appEvents: AppEvents = noEvents;

  /** 28d: reports from partner communities that were settled, so the partner hears "reviewed". */
  private partnerOutcomes: (
    settled: { partnerId: string; partnerReportId: string }[],
  ) => Promise<void> = async () => undefined;
  usePartnerOutcomes(
    fn: (settled: { partnerId: string; partnerReportId: string }[]) => Promise<void>,
  ): void {
    this.partnerOutcomes = fn;
  }

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
    const [partner] = report!.partnerId
      ? await this.db
          .select({ name: schema.federationPartners.name })
          .from(schema.federationPartners)
          .where(eq(schema.federationPartners.id, report!.partnerId))
      : [];
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
        explanation: moderationLog.explanation,
        reversedAt: moderationLog.reversedAt,
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
      partnerCommunity: report!.partnerId ? (partner?.name ?? '') : null,
      automatic: report!.automatic,
      evidence: evidence.map((e) => ({
        id: e.id,
        from: e.fromReported ? ('reported' as const) : ('reporter' as const),
        kind: e.kind === 'voice' ? ('voice' as const) : ('text' as const),
        body: e.body,
        durationMs: e.durationMs,
        flags: e.flags,
        unsent: e.unsent,
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
        explanation: h.explanation,
        reversed: h.reversedAt !== null,
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
    /** Phase 61, the statement of reasons the member reads. */
    statement: { ground: ModerationGround; explanation?: string | undefined } = { ground: 'terms' },
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
    const settled = await this.db.transaction(async (tx) => {
      const now = new Date();
      const resolution = {
        status: action === 'dismiss' ? ('dismissed' as const) : ('actioned' as const),
        resolvedBy: staff.id,
        resolvedAction: action,
        resolvedReason: reason,
        resolvedAt: now,
      };
      // Suspending or banning settles every open report against the same member.
      const updated = await tx
        .update(reports)
        .set(resolution)
        .where(
          removesAccess
            ? and(eq(reports.reportedId, report.reportedId), eq(reports.status, 'open'))
            : eq(reports.id, reportId),
        )
        .returning({ partnerId: reports.partnerId, partnerReportId: reports.partnerReportId });
      if (action !== 'dismiss') {
        await tx.insert(moderationLog).values({
          targetId: report.reportedId,
          staffId: staff.id,
          reportId,
          action,
          category: report.category,
          reason,
          ground: statement.ground,
          explanation: statement.explanation ?? null,
          automatedDetection: report.automatic,
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
        // Their photos can't come back on a new account (phase 21).
        await tx.execute(sql`
          INSERT INTO banned_photo_hashes (hash, user_id)
          SELECT DISTINCT phash, user_id FROM photos
          WHERE user_id = ${report.reportedId} AND phash IS NOT NULL`);
        // Phase 73b: where the community shares trust signals, the hashes (only) go to every
        // connected partner, through the outbox, for review there.
        await tx.execute(sql`
          WITH hashes AS (
            SELECT jsonb_agg(h::text) AS list FROM (
              SELECT DISTINCT phash AS h FROM photos
              WHERE user_id = ${report.reportedId} AND phash IS NOT NULL
              LIMIT ${MAX_SIGNAL_HASHES}) x),
          signal AS (
            INSERT INTO federation_signals_out (user_id)
            SELECT ${report.reportedId}
            WHERE COALESCE((SELECT share_trust_signals FROM instance_settings WHERE id = 1), false)
              AND (SELECT list FROM hashes) IS NOT NULL
              AND EXISTS (SELECT 1 FROM federation_partners WHERE status = 'active')
            RETURNING id)
          INSERT INTO federation_outbox (partner_id, path, payload)
          SELECT p.id, ${FEDERATION_SIGNALS_PATH}, jsonb_build_object(
            'id', signal.id, 'hashes', (SELECT list FROM hashes), 'category', ${report.category}::text)
          FROM signal, federation_partners p WHERE p.status = 'active'`);
      }
      await audit(tx, {
        actorId: staff.id,
        action: `moderation.${action}`,
        targetType: 'user',
        targetId: report.reportedId,
        meta: { report: reportId, category: report.category },
      });
      return updated.flatMap((u) =>
        u.partnerId && u.partnerReportId
          ? [{ partnerId: u.partnerId, partnerReportId: u.partnerReportId }]
          : [],
      );
    });
    if (removesAccess) await this.discovery.closeAllMatches(report.reportedId);
    if (settled.length > 0) await this.partnerOutcomes(settled).catch(() => undefined);
    this.appEvents.emit({ type: 'report.resolved', reportId });
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
    await this.db.transaction((tx) => liftModeration(tx, staff.id, userId, reason));
  }

  async auditLog(
    before: string | undefined,
    limit: number,
    only?: 'staff_access',
  ): Promise<AuditEntry[]> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      // Members' own sign-in history (phase 31) is for them, not for staff.
      .where(
        and(
          ne(auditLogs.action, 'session.created'),
          before ? lt(auditLogs.createdAt, new Date(before)) : undefined,
          // Phase 64: who looked at member data.
          only === 'staff_access'
            ? inArray(auditLogs.action, [...STAFF_ACCESS_ACTIONS])
            : undefined,
        ),
      )
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

  /** Staff playback of reported voice evidence (audited). Returns the storage key. */
  async evidenceAudio(staff: AuthUser, reportId: string, evidenceId: string): Promise<string> {
    const [row] = await this.db
      .select({ key: reportEvidence.mediaKey })
      .from(reportEvidence)
      .where(and(eq(reportEvidence.id, evidenceId), eq(reportEvidence.reportId, reportId)));
    if (!row?.key) throw notFound();
    await audit(this.db, {
      actorId: staff.id,
      action: 'staff.evidence_audio_played',
      targetType: 'report',
      targetId: reportId,
    });
    return row.key;
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
