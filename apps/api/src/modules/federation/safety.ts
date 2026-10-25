// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  federatedReportOutcomeSchema,
  federatedWireReportSchema,
  MAX_REPORT_EVIDENCE,
  reportPriority,
  type FederatedReportInput,
  type FederatedWireReport,
} from '@nexaheart/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { FederatedMembers } from './members.js';
import type { FederationService, IncomingSigned } from './service.js';

const {
  federationAliases,
  federationMatches,
  federationMessages,
  federationPartners,
  federationReportsOut,
  reportEvidence,
  reports,
} = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const badRequest = () => new HttpError(400, ErrorCode.BadRequest, 'Malformed request.');

function parseBody(incoming: IncomingSigned): unknown {
  try {
    return JSON.parse(incoming.body);
  } catch {
    return null;
  }
}

/**
 * Safety across communities (phase 28d): a report goes to the reported person's own community,
 * which handles it with its own rules and only says back that it was reviewed.
 */
export class FederatedSafety {
  constructor(
    private readonly db: Database,
    private readonly federation: FederationService,
    private readonly members: FederatedMembers,
    /** Tells this community's staff an urgent report is waiting (no content in the email). */
    private readonly alertStaff: () => Promise<void>,
  ) {}

  /** A member here reports someone from a partner community. */
  async report(
    userId: string,
    input: Omit<FederatedReportInput, 'block' | 'attach'> & { block: boolean; attach: boolean },
  ): Promise<{ reportId: string }> {
    const partner = await this.federation.activePartner(input.partnerId);
    if (!partner) throw notFound();
    const [already] = await this.db
      .select({ id: federationReportsOut.id })
      .from(federationReportsOut)
      .where(
        and(
          eq(federationReportsOut.userId, userId),
          eq(federationReportsOut.partnerId, partner.id),
          eq(federationReportsOut.alias, input.alias),
        ),
      );
    if (already) throw new HttpError(409, ErrorCode.Conflict, 'You already reported this person.');

    // Evidence: the reporter's own chat with the person, copied here, never taken from the app.
    const [match] = await this.db
      .select({ id: federationMatches.id })
      .from(federationMatches)
      .where(
        and(
          eq(federationMatches.partnerId, partner.id),
          eq(federationMatches.userId, userId),
          eq(federationMatches.alias, input.alias),
        ),
      );
    const evidence =
      match && input.attach
        ? (
            await this.db
              .select({
                mine: federationMessages.mine,
                body: federationMessages.body,
                createdAt: federationMessages.createdAt,
              })
              .from(federationMessages)
              .where(eq(federationMessages.matchId, match.id))
              .orderBy(desc(federationMessages.createdAt))
              .limit(MAX_REPORT_EVIDENCE)
          ).reverse()
        : [];

    const [row] = await this.db
      .insert(federationReportsOut)
      .values({ userId, partnerId: partner.id, alias: input.alias, category: input.category })
      .returning({ id: federationReportsOut.id });
    const wire: FederatedWireReport = {
      id: row!.id,
      from: await this.members.aliasOf(partner.id, userId),
      about: input.alias,
      category: input.category,
      details: input.details && input.details.length > 0 ? input.details : null,
      evidence: evidence.map((m) => ({
        fromReported: !m.mine,
        body: m.body,
        sentAt: m.createdAt.toISOString(),
      })),
    };
    // Reliable: if their server is down, the outbox keeps trying.
    await this.federation.deliver(partner, '/v1/federation/reports', wire);
    await audit(this.db, {
      actorId: userId,
      action: 'federation.report_sent',
      targetType: 'partner',
      targetId: partner.url,
      meta: { category: input.category, evidence: evidence.length },
    });
    if (input.block) {
      await this.members
        .interact(userId, { partnerId: partner.id, alias: input.alias, kind: 'block' })
        .catch(() => undefined);
    }
    return { reportId: row!.id };
  }

  /** A partner's member reported one of ours: into our own moderation queue. */
  async receiveReport(incoming: IncomingSigned): Promise<{ accepted: boolean }> {
    const partner = await this.federation.verifyActive(incoming);
    const parsed = federatedWireReportSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    const report = parsed.data;
    // Whoever had this alias, even if they left since (the alias stays until then).
    const [owner] = await this.db
      .select({ userId: federationAliases.userId })
      .from(federationAliases)
      .where(
        and(eq(federationAliases.partnerId, partner.id), eq(federationAliases.alias, report.about)),
      );
    if (!owner) return { accepted: false };
    const priority = reportPriority(report.category);
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reports)
        .values({
          reporterId: null,
          reportedId: owner.userId,
          category: report.category,
          priority,
          details: report.details,
          partnerId: partner.id,
          partnerReportId: report.id,
        })
        .onConflictDoNothing()
        .returning({ id: reports.id });
      if (!row) return null; // A retry of a report already received.
      if (report.evidence.length > 0) {
        await tx.insert(reportEvidence).values(
          report.evidence.map((e) => ({
            reportId: row.id,
            fromReported: e.fromReported,
            kind: 'text' as const,
            body: e.body,
            sentAt: new Date(e.sentAt),
          })),
        );
      }
      await audit(tx, {
        actorId: null,
        action: 'federation.report_received',
        targetType: 'report',
        targetId: row.id,
        meta: { category: report.category, priority, evidence: report.evidence.length },
      });
      return row.id;
    });
    if (created && priority === 'urgent') await this.alertStaff().catch(() => undefined);
    return { accepted: true };
  }

  /** Our moderators settled reports from partners: each partner hears only "reviewed". */
  async sendOutcomes(settled: { partnerId: string; partnerReportId: string }[]): Promise<void> {
    for (const s of settled) {
      const [partner] = await this.db
        .select()
        .from(federationPartners)
        .where(and(eq(federationPartners.id, s.partnerId), ne(federationPartners.status, 'ended')));
      if (!partner) continue;
      await this.federation.deliver(partner, '/v1/federation/report-outcomes', {
        reportId: s.partnerReportId,
        outcome: 'reviewed',
      });
    }
  }

  async receiveOutcome(incoming: IncomingSigned): Promise<void> {
    const partner = await this.federation.verifyActive(incoming);
    const parsed = federatedReportOutcomeSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    await this.db
      .update(federationReportsOut)
      .set({ reviewedAt: new Date() })
      .where(
        and(
          eq(federationReportsOut.id, parsed.data.reportId),
          eq(federationReportsOut.partnerId, partner.id),
        ),
      );
  }
}
