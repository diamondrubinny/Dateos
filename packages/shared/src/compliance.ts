// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import {
  appealableActions,
  appealStatuses,
  moderationGrounds,
  reportCategories,
} from './moderation.js';

/**
 * Phase 64, the compliance kit: a transparency report (DSA Art. 15 and 24) 📘, a security incident
 * log (Israel's data security regulations, GDPR Art. 33) ⚖️ 📘 and document templates.
 */

/** The longest period a transparency report covers. */
export const MAX_REPORT_DAYS = 366;

const day = z.iso.date();

export const transparencyQuerySchema = z
  .object({ from: day, to: day })
  .refine((q) => q.from <= q.to, { message: '"from" must not be after "to"', path: ['from'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_REPORT_DAYS, {
    message: `At most ${MAX_REPORT_DAYS} days`,
    path: ['to'],
  });
export type TransparencyQuery = z.infer<typeof transparencyQuerySchema>;

export const noticeSources = ['members', 'automatic', 'partners'] as const;
export type NoticeSource = (typeof noticeSources)[number];

const counts = <T extends readonly [string, ...string[]]>(keys: T) =>
  z.record(z.enum(keys), z.number().int().min(0));

/** Counts only: no names, ids or text. */
export const transparencyReportSchema = z.object({
  period: z.object({ from: day, to: day }),
  generatedAt: z.string(),
  notices: z.object({
    total: z.number().int(),
    bySource: counts(noticeSources),
    byCategory: counts(reportCategories),
    /** Notices closed in the period: with a decision, or with no action. */
    closed: z.object({ actioned: z.number().int(), dismissed: z.number().int() }),
    /** Median hours from a notice to closing it, for notices closed in the period. */
    medianHoursToDecision: z.number().nullable(),
  }),
  /** Restrictions (warnings, suspensions, bans); closing a notice with no action isn't one. */
  decisions: z.object({
    total: z.number().int(),
    byAction: counts(appealableActions),
    byGround: counts(moderationGrounds),
    /** Opened by an automatic check; a person still decided. */
    automatedDetection: z.number().int(),
    reversed: z.number().int(),
  }),
  appeals: z.object({
    received: z.number().int(),
    byStatus: counts(appealStatuses),
    medianDaysToDecide: z.number().nullable(),
  }),
  /** Accounts suspended because an age check said under 18 (phase 63). */
  underageSuspensions: z.number().int(),
  /** A snapshot when the report is made, not an average over the period. 📘 */
  membersActiveLast30Days: z.number().int(),
  retentionNote: z.string(),
});
export type TransparencyReport = z.infer<typeof transparencyReportSchema>;

/** One row per number, for spreadsheets. Values are numbers or ISO dates, never member data. */
export function transparencyCsv(report: TransparencyReport): string {
  const rows: [string, string, string | number | null][] = [
    ['period', 'from', report.period.from],
    ['period', 'to', report.period.to],
    ['notices', 'total', report.notices.total],
    ...Object.entries(report.notices.bySource).map(
      ([k, v]) => ['notices_by_source', k, v] as [string, string, number],
    ),
    ...Object.entries(report.notices.byCategory).map(
      ([k, v]) => ['notices_by_category', k, v] as [string, string, number],
    ),
    ['notices', 'closed_actioned', report.notices.closed.actioned],
    ['notices', 'closed_dismissed', report.notices.closed.dismissed],
    ['notices', 'median_hours_to_decision', report.notices.medianHoursToDecision],
    ['decisions', 'total', report.decisions.total],
    ...Object.entries(report.decisions.byAction).map(
      ([k, v]) => ['decisions_by_action', k, v] as [string, string, number],
    ),
    ...Object.entries(report.decisions.byGround).map(
      ([k, v]) => ['decisions_by_ground', k, v] as [string, string, number],
    ),
    ['decisions', 'automated_detection', report.decisions.automatedDetection],
    ['decisions', 'reversed', report.decisions.reversed],
    ['appeals', 'received', report.appeals.received],
    ...Object.entries(report.appeals.byStatus).map(
      ([k, v]) => ['appeals_by_status', k, v] as [string, string, number],
    ),
    ['appeals', 'median_days_to_decide', report.appeals.medianDaysToDecide],
    ['accounts', 'underage_suspensions', report.underageSuspensions],
    ['accounts', 'members_active_last_30_days', report.membersActiveLast30Days],
  ];
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ['section,item,value', ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------------------ incidents

export const incidentKinds = [
  'unauthorized_access',
  'data_leak',
  'lost_device',
  'malware',
  'outage',
  'other',
] as const;
export type IncidentKind = (typeof incidentKinds)[number];

export const incidentSeverities = ['low', 'medium', 'high', 'severe'] as const;
export type IncidentSeverity = (typeof incidentSeverities)[number];

/** GDPR Art. 33: notify the authority within 72 hours of becoming aware, where there's a risk. ⚖️ */
export const INCIDENT_NOTIFY_HOURS = 72;

/** When the authority should be notified by, for high and severe incidents not yet reported. */
export function incidentNotifyBy(incident: {
  severity: IncidentSeverity;
  discoveredAt: string;
  authorityNotifiedAt: string | null;
}): string | null {
  if (incident.authorityNotifiedAt) return null;
  if (incident.severity !== 'high' && incident.severity !== 'severe') return null;
  return new Date(
    Date.parse(incident.discoveredAt) + INCIDENT_NOTIFY_HOURS * 3_600_000,
  ).toISOString();
}

/** Plain text, line breaks allowed (incidents are written by admins and read by admins). */
const incidentText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .refine((v) => !/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F<>]/.test(v), 'Plain text only');

const instant = z.iso.datetime({ offset: true });

const incidentFields = {
  title: incidentText(120),
  kind: z.enum(incidentKinds),
  severity: z.enum(incidentSeverities),
  occurredAt: instant.nullable(),
  discoveredAt: instant,
  /** An estimate; null when unknown. */
  affectedMembers: z.number().int().min(0).max(100_000_000).nullable(),
  description: incidentText(2000),
  actions: incidentText(2000).nullable(),
  authorityNotifiedAt: instant.nullable(),
  membersNotifiedAt: instant.nullable(),
  closedAt: instant.nullable(),
};

const notBefore = (a: string | null | undefined, b: string | null | undefined) =>
  !a || !b || Date.parse(a) >= Date.parse(b);

export const incidentInputSchema = z
  .object({
    ...incidentFields,
    occurredAt: incidentFields.occurredAt.default(null),
    affectedMembers: incidentFields.affectedMembers.default(null),
    actions: incidentFields.actions.default(null),
    authorityNotifiedAt: incidentFields.authorityNotifiedAt.default(null),
    membersNotifiedAt: incidentFields.membersNotifiedAt.default(null),
    closedAt: incidentFields.closedAt.default(null),
  })
  .strict()
  .refine((i) => notBefore(i.discoveredAt, i.occurredAt), {
    message: 'Found before it happened?',
    path: ['discoveredAt'],
  });
export type IncidentInput = z.infer<typeof incidentInputSchema>;
/** What a client sends (the optional fields may be left out). */
export type IncidentDraft = z.input<typeof incidentInputSchema>;

/** Every field can change; the dates are checked against the saved incident too. */
export const incidentUpdateSchema = z.object(incidentFields).partial().strict();
export type IncidentUpdate = z.infer<typeof incidentUpdateSchema>;

/** The saved incident with the update applied makes sense. */
export function incidentDatesInOrder(i: {
  occurredAt: string | null;
  discoveredAt: string;
  authorityNotifiedAt: string | null;
  membersNotifiedAt: string | null;
  closedAt: string | null;
}): boolean {
  return (
    notBefore(i.discoveredAt, i.occurredAt) &&
    notBefore(i.authorityNotifiedAt, i.discoveredAt) &&
    notBefore(i.membersNotifiedAt, i.discoveredAt) &&
    notBefore(i.closedAt, i.discoveredAt)
  );
}

export const incidentSchema = z.object({
  id: z.uuid(),
  ...incidentFields,
  notifyBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Incident = z.infer<typeof incidentSchema>;

// ------------------------------------------------------------------------------ templates

export const complianceTemplates = [
  'security-statement',
  'no-paid-features',
  'risk-assessment',
] as const;
export type ComplianceTemplate = (typeof complianceTemplates)[number];

export const templateLocales = ['en', 'he'] as const;

export const templateParamsSchema = z.object({ name: z.enum(complianceTemplates) });
export const templateQuerySchema = z.object({ locale: z.enum(templateLocales).default('en') });

/** Audit page filter (phase 64): staff access to member data only. */
export const STAFF_ACCESS_ACTIONS = [
  'staff.report_viewed',
  'staff.selfie_viewed',
  'staff.photo_viewed',
  'staff.evidence_audio_played',
] as const;
