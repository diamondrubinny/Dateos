import { schema, type Database } from '@dateos/db';
import type { reportInputSchema } from '@dateos/shared';
import { ErrorCode, reportPriority } from '@dateos/shared';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { audit } from '../../lib/audit.js';
import type { Mailer } from '../../lib/mailer.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { DiscoveryService } from '../discovery/service.js';

const { reports, reportEvidence, messages, matches, user } = schema;

type ReportInput = z.output<typeof reportInputSchema>;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

export class ReportService {
  constructor(
    private readonly db: Database,
    private readonly discovery: DiscoveryService,
    private readonly mailer: Mailer,
    private readonly instanceName: string,
    private readonly onMailError: (error: unknown) => void,
  ) {}

  async create(reporterId: string, input: ReportInput): Promise<{ reportId: string }> {
    const { targetId } = input;
    if (!(await this.discovery.hasContact(reporterId, targetId))) throw notFound();

    const [a, b] = [reporterId, targetId].sort() as [string, string];
    const [match] = await this.db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.userA, a), eq(matches.userB, b)));

    // Evidence is copied from the database, never taken from the client, and only from the
    // reporter's own chat with the person they report.
    const evidence =
      match && input.messageIds.length > 0
        ? await this.db
            .select({
              senderId: messages.senderId,
              body: messages.body,
              flags: messages.flags,
              createdAt: messages.createdAt,
            })
            .from(messages)
            .where(
              and(
                eq(messages.matchId, match.id),
                inArray(messages.id, input.messageIds),
                eq(messages.kind, 'text'),
                isNotNull(messages.body),
              ),
            )
            .orderBy(messages.createdAt)
        : [];

    const priority = reportPriority(input.category);
    const reportId = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(reports)
        .values({
          reporterId,
          reportedId: targetId,
          matchId: match?.id ?? null,
          category: input.category,
          priority,
          details: input.details && input.details.length > 0 ? input.details : null,
        })
        .onConflictDoNothing()
        .returning({ id: reports.id });
      if (inserted.length === 0) {
        throw new HttpError(409, ErrorCode.Conflict, 'You already reported this person.');
      }
      const id = inserted[0]!.id;
      if (evidence.length > 0) {
        await tx.insert(reportEvidence).values(
          evidence.map((m) => ({
            reportId: id,
            fromReported: m.senderId === targetId,
            body: m.body!,
            flags: m.flags,
            sentAt: m.createdAt,
          })),
        );
      }
      await audit(tx, {
        actorId: reporterId,
        action: 'report.created',
        targetType: 'report',
        targetId: id,
        meta: { category: input.category, priority, evidence: evidence.length },
      });
      return id;
    });

    if (input.block) await this.discovery.block(reporterId, targetId);
    if (priority === 'urgent') await this.alertStaff();
    return { reportId };
  }

  /** Tells staff that an urgent report is waiting. The email carries no report content. */
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
          subject: `${this.instanceName}: urgent report waiting`,
          text: `An urgent report is waiting in the ${this.instanceName} moderation queue.\n\nOpen the moderation dashboard to review it. Report details are only available there.`,
          html: '<p>An urgent report is waiting in the moderation queue.</p><p>Open the moderation dashboard to review it. Report details are only available there.</p>',
        })
        .catch(this.onMailError);
    }
  }
}
