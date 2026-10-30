// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  appealStatuses,
  ErrorCode,
  incidentDatesInOrder,
  incidentNotifyBy,
  MODERATION_LOG_RETENTION_DAYS,
  appealableActions,
  moderationGrounds,
  noticeSources,
  reportCategories,
  type ComplianceTemplate,
  type Incident,
  type IncidentInput,
  type IncidentKind,
  type IncidentSeverity,
  type IncidentUpdate,
  type TransparencyQuery,
  type TransparencyReport,
} from '@nexaheart/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { readCommunitySettings, readIdentitySettings } from '../../lib/community-settings.js';
import { HttpError } from '../../plugins/error-handler.js';
import { renderTemplate, type TemplateFacts } from './templates.js';

const { securityIncidents, instanceSettings, federationPartners } = schema;

type Count = { key: string | null; n: number };

/** Every key of the list, 0 where nothing was counted. */
function fill<K extends string>(keys: readonly K[], list: Count[]): Record<K, number> {
  const found = Object.fromEntries(list.filter((r) => r.key !== null).map((r) => [r.key!, r.n]));
  return Object.fromEntries(keys.map((k) => [k, found[k] ?? 0])) as Record<K, number>;
}

type IncidentRow = typeof securityIncidents.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toIncident(r: IncidentRow): Incident {
  const view = {
    id: r.id,
    title: r.title,
    kind: r.kind as IncidentKind,
    severity: r.severity as IncidentSeverity,
    occurredAt: iso(r.occurredAt),
    discoveredAt: r.discoveredAt.toISOString(),
    affectedMembers: r.affectedMembers,
    description: r.description,
    actions: r.actions,
    authorityNotifiedAt: iso(r.authorityNotifiedAt),
    membersNotifiedAt: iso(r.membersNotifiedAt),
    closedAt: iso(r.closedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
  return { ...view, notifyBy: incidentNotifyBy(view) };
}

const date = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/**
 * Phase 64, the compliance kit (admins only): the transparency report, the security incident log
 * and document templates filled from this community's settings. ⚖️ 📘
 */
export class ComplianceService {
  constructor(
    private readonly db: Database,
    private readonly facts: {
      instanceName: string;
      ageCheckProvider: boolean;
      externalAi: boolean;
      videoCalls: boolean;
    },
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts only, for the period [from, to] (whole days, UTC). */
  async transparency({ from, to }: TransparencyQuery): Promise<TransparencyReport> {
    const start = sql`${from}::date`;
    const end = sql`(${to}::date + 1)`;
    const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
      (await this.db.execute<T>(query)).rows;
    const [
      sources,
      categories,
      decided,
      actions,
      grounds,
      detection,
      appeals,
      appealTime,
      underage,
      active,
    ] = await Promise.all([
      rows<Count>(sql`SELECT CASE WHEN partner_id IS NOT NULL THEN 'partners'
              WHEN automatic THEN 'automatic' ELSE 'members' END AS key, count(*)::int AS n
            FROM reports WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1`),
      rows<Count>(sql`SELECT category::text AS key, count(*)::int AS n FROM reports
            WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1`),
      rows<{ median: number | null; actioned: number; dismissed: number }>(sql`SELECT
              round((percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM resolved_at - created_at)) / 3600)::numeric, 1)::float AS median,
              count(*) FILTER (WHERE status = 'actioned')::int AS actioned,
              count(*) FILTER (WHERE status = 'dismissed')::int AS dismissed
            FROM reports WHERE resolved_at >= ${start} AND resolved_at < ${end}`),
      rows<Count>(sql`SELECT action::text AS key, count(*)::int AS n FROM moderation_actions
            WHERE created_at >= ${start} AND created_at < ${end} AND action <> 'unsuspend' GROUP BY 1`),
      rows<Count>(sql`SELECT ground::text AS key, count(*)::int AS n FROM moderation_actions
            WHERE created_at >= ${start} AND created_at < ${end} AND action <> 'unsuspend' GROUP BY 1`),
      rows<{ automated: number; reversed: number }>(sql`SELECT
              count(*) FILTER (WHERE automated_detection)::int AS automated,
              count(*) FILTER (WHERE reversed_at IS NOT NULL)::int AS reversed
            FROM moderation_actions
            WHERE created_at >= ${start} AND created_at < ${end} AND action <> 'unsuspend'`),
      rows<Count>(sql`SELECT status::text AS key, count(*)::int AS n FROM moderation_appeals
            WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1`),
      rows<{ median: number | null }>(sql`SELECT round((percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM decided_at - created_at)) / 86400)::numeric, 1)::float AS median
            FROM moderation_appeals WHERE decided_at >= ${start} AND decided_at < ${end}`),
      rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_logs
            WHERE action = 'account.suspended_underage' AND created_at >= ${start} AND created_at < ${end}`),
      rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM "user"
            WHERE role = 'user' AND last_seen_at > now() - interval '30 days'`),
    ]);
    const byAction = fill(appealableActions, actions);
    const byStatus = fill(appealStatuses, appeals);
    const bySource = fill(noticeSources, sources);
    return {
      period: { from, to },
      generatedAt: new Date(this.now()).toISOString(),
      notices: {
        total: Object.values(bySource).reduce((a, b) => a + b, 0),
        bySource,
        byCategory: fill(reportCategories, categories),
        closed: { actioned: decided[0]?.actioned ?? 0, dismissed: decided[0]?.dismissed ?? 0 },
        medianHoursToDecision: decided[0]?.median ?? null,
      },
      decisions: {
        total: Object.values(byAction).reduce((a, b) => a + b, 0),
        byAction,
        byGround: fill(moderationGrounds, grounds),
        automatedDetection: detection[0]?.automated ?? 0,
        reversed: detection[0]?.reversed ?? 0,
      },
      appeals: {
        received: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        medianDaysToDecide: appealTime[0]?.median ?? null,
      },
      underageSuspensions: underage[0]?.n ?? 0,
      membersActiveLast30Days: active[0]?.n ?? 0,
      retentionNote: `Decisions are kept for ${MODERATION_LOG_RETENTION_DAYS} days and deleted with the account they concern; older or deleted ones aren't counted.`,
    };
  }

  // ---------------------------------------------------------------------------- incidents

  async incidents(): Promise<Incident[]> {
    const rows = await this.db
      .select()
      .from(securityIncidents)
      .orderBy(desc(securityIncidents.discoveredAt))
      .limit(200);
    return rows.map(toIncident);
  }

  async createIncident(adminId: string, input: IncidentInput): Promise<Incident> {
    if (!incidentDatesInOrder(input)) throw badDates();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(securityIncidents)
        .values({
          ...input,
          occurredAt: date(input.occurredAt),
          discoveredAt: new Date(input.discoveredAt),
          authorityNotifiedAt: date(input.authorityNotifiedAt),
          membersNotifiedAt: date(input.membersNotifiedAt),
          closedAt: date(input.closedAt),
          createdBy: adminId,
        })
        .returning();
      await audit(tx, {
        actorId: adminId,
        action: 'incident.created',
        targetType: 'incident',
        targetId: row!.id,
        meta: { severity: input.severity, kind: input.kind },
      });
      return toIncident(row!);
    });
  }

  async updateIncident(adminId: string, id: string, update: IncidentUpdate): Promise<Incident> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(securityIncidents)
        .where(eq(securityIncidents.id, id))
        .for('update');
      if (!current) throw notFound();
      const merged: Incident = { ...toIncident(current) };
      for (const [key, value] of Object.entries(update)) {
        if (value !== undefined) Object.assign(merged, { [key]: value });
      }
      if (!incidentDatesInOrder(merged)) throw badDates();
      const [row] = await tx
        .update(securityIncidents)
        .set({
          ...update,
          occurredAt: date(update.occurredAt),
          discoveredAt: update.discoveredAt ? new Date(update.discoveredAt) : undefined,
          authorityNotifiedAt: date(update.authorityNotifiedAt),
          membersNotifiedAt: date(update.membersNotifiedAt),
          closedAt: date(update.closedAt),
          updatedAt: new Date(this.now()),
        })
        .where(eq(securityIncidents.id, id))
        .returning();
      await audit(tx, {
        actorId: adminId,
        action: 'incident.updated',
        targetType: 'incident',
        targetId: id,
        // Which fields changed, never their text.
        meta: { fields: Object.keys(update).sort().join(',') },
      });
      return toIncident(row!);
    });
  }

  // ---------------------------------------------------------------------------- templates

  async template(name: ComplianceTemplate, locale: 'en' | 'he'): Promise<string> {
    const [settings] = await this.db
      .select({
        name: instanceSettings.name,
        operatorName: instanceSettings.operatorName,
        contactEmail: instanceSettings.contactEmail,
        callsEnabled: instanceSettings.callsEnabled,
        ageCheckRequired: instanceSettings.ageCheckRequired,
      })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1));
    const [community, identity, partners] = await Promise.all([
      readCommunitySettings(this.db),
      readIdentitySettings(this.db),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(federationPartners)
        .where(eq(federationPartners.status, 'active')),
    ]);
    const facts: TemplateFacts = {
      community: settings?.name ?? this.facts.instanceName,
      operator: settings?.operatorName ?? null,
      contact: settings?.contactEmail ?? null,
      date: new Date(this.now()).toISOString().slice(0, 10),
      videoCalls: this.facts.videoCalls && (settings?.callsEnabled ?? true),
      ageCheck: this.facts.ageCheckProvider && (settings?.ageCheckRequired ?? false),
      externalAi: this.facts.externalAi,
      partners: partners[0]?.n ?? 0,
      faith: community.faith,
      identity: identity.vocabulary === 'extended' || identity.customGender,
      minAge: community.join.minAge,
      friendsOnly: community.intentions.length === 1 && community.intentions[0] === 'friends',
    };
    return renderTemplate(name, locale, facts);
  }
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

function badDates() {
  return new HttpError(400, ErrorCode.ValidationError, 'The dates are out of order.');
}
