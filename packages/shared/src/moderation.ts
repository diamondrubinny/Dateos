import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reports (any member)
// ---------------------------------------------------------------------------

export const reportCategories = [
  'underage',
  'threat',
  'harassment',
  'scam',
  'fake_profile',
  'inappropriate_photos',
  'spam',
  'other',
] as const;
export type ReportCategory = (typeof reportCategories)[number];

export const reportPriorities = ['urgent', 'high', 'normal'] as const;
export type ReportPriority = (typeof reportPriorities)[number];

/** Triage order: possible minors and threats first, then scams and harassment. */
export function reportPriority(category: ReportCategory): ReportPriority {
  switch (category) {
    case 'underage':
    case 'threat':
      return 'urgent';
    case 'scam':
    case 'harassment':
      return 'high';
    default:
      return 'normal';
  }
}

export const MAX_REPORT_EVIDENCE = 20;
export const MAX_REPORT_DETAILS = 1000;

export const reportInputSchema = z.object({
  targetId: z.string().min(1).max(64),
  category: z.enum(reportCategories),
  details: z.string().trim().max(MAX_REPORT_DETAILS).optional(),
  /** Messages from the reporter's own chat with the target; copied server-side as evidence. */
  messageIds: z.array(z.uuid()).max(MAX_REPORT_EVIDENCE).default([]),
  /** Reporting blocks the person too, unless the reporter opts out. */
  block: z.boolean().default(true),
});
export type ReportInput = z.input<typeof reportInputSchema>;

export const reportResultSchema = z.object({ reportId: z.uuid() });

// ---------------------------------------------------------------------------
// Account notices shown to the member (warnings, suspension)
// ---------------------------------------------------------------------------

export const accountNoticeSchema = z.object({
  id: z.uuid(),
  kind: z.literal('warning'),
  category: z.enum(reportCategories),
  createdAt: z.string(),
});
export type AccountNotice = z.infer<typeof accountNoticeSchema>;

// ---------------------------------------------------------------------------
// Photo verification (human review, no automated face recognition)
// ---------------------------------------------------------------------------

export const verificationPoses = [
  'thumbs_up',
  'peace_sign',
  'hand_on_head',
  'point_at_camera',
  'wave',
] as const;
export type VerificationPose = (typeof verificationPoses)[number];

export const verificationStatuses = [
  'none',
  'awaiting_selfie',
  'pending',
  'approved',
  'rejected',
] as const;

export const verificationStateSchema = z.object({
  status: z.enum(verificationStatuses),
  pose: z.enum(verificationPoses).nullable(),
  /** Selfie still being scanned; the review starts afterwards. */
  processing: z.boolean(),
  decidedAt: z.string().nullable(),
});
export type VerificationState = z.infer<typeof verificationStateSchema>;

// ---------------------------------------------------------------------------
// Staff (moderators and admins)
// ---------------------------------------------------------------------------

export const staffRoles = ['moderator', 'admin'] as const;
export type StaffRole = (typeof staffRoles)[number];

/** How long a TOTP check unlocks the moderation tools for one session. */
export const STAFF_MFA_TTL_MS = 12 * 60 * 60 * 1000;

export const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const staffMeSchema = z.object({
  role: z.enum(staffRoles),
  mfaEnabled: z.boolean(),
  mfaVerified: z.boolean(),
});
export type StaffMe = z.infer<typeof staffMeSchema>;

export const mfaSetupSchema = z.object({ secret: z.string(), otpauthUrl: z.string() });

export const moderationActions = ['dismiss', 'warn', 'suspend', 'ban'] as const;
export type ModerationAction = (typeof moderationActions)[number];

export const resolveReportSchema = z.object({
  action: z.enum(moderationActions),
  /** Internal note for the audit trail; never shown to the member. */
  reason: z.string().trim().min(3).max(500),
});

export const liftSuspensionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const reportStatuses = ['open', 'dismissed', 'actioned'] as const;

export const reportSummarySchema = z.object({
  id: z.uuid(),
  category: z.enum(reportCategories),
  priority: z.enum(reportPriorities),
  status: z.enum(reportStatuses),
  createdAt: z.string(),
  reported: z.object({ id: z.string(), displayName: z.string().nullable(), status: z.string() }),
  /** Open reports against the same member, including this one. */
  openReportsAgainst: z.number().int(),
  evidenceCount: z.number().int(),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const evidenceMessageSchema = z.object({
  id: z.uuid(),
  from: z.enum(['reporter', 'reported']),
  kind: z.enum(['text', 'voice']),
  /** Text, or null for a voice message (listen through the audited audio route). */
  body: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  flags: z.array(z.string()),
  sentAt: z.string(),
});

export const moderationHistorySchema = z.object({
  action: z.enum([...moderationActions, 'unsuspend']),
  category: z.enum(reportCategories).nullable(),
  reason: z.string(),
  staffName: z.string().nullable(),
  createdAt: z.string(),
});

export const reportDetailSchema = reportSummarySchema.extend({
  details: z.string().nullable(),
  reporter: z.object({ id: z.string().nullable(), displayName: z.string().nullable() }),
  evidence: z.array(evidenceMessageSchema),
  resolution: z
    .object({ action: z.enum(moderationActions), reason: z.string(), resolvedAt: z.string() })
    .nullable(),
  reportedProfile: z
    .object({
      age: z.number().int(),
      gender: z.string(),
      bio: z.string().nullable(),
      prompts: z.array(z.object({ promptKey: z.string(), answer: z.string() })),
      photoIds: z.array(z.uuid()),
      verified: z.boolean(),
      memberSince: z.string(),
      role: z.string(),
    })
    .nullable(),
  history: z.array(moderationHistorySchema),
});
export type ReportDetail = z.infer<typeof reportDetailSchema>;

export const verificationReviewSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  displayName: z.string().nullable(),
  pose: z.enum(verificationPoses),
  createdAt: z.string(),
  profilePhotoIds: z.array(z.uuid()),
});
export type VerificationReview = z.infer<typeof verificationReviewSchema>;

export const decideVerificationSchema = z.object({ approve: z.boolean() });

export const auditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actorId: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditQuerySchema = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Retention (see docs/phases/PHASE-4.md). Requires legal review per instance. */
export const RESOLVED_REPORT_RETENTION_DAYS = 365;
export const MODERATION_LOG_RETENTION_DAYS = 730;
export const VERIFICATION_RECORD_RETENTION_DAYS = 730;
