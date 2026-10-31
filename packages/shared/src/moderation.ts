// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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

/** How long "Your report was reviewed" stays available after the decision (phase 37). */
export const REPORT_OUTCOME_DAYS = 30;
export const accountNoticeSchema = z.object({
  id: z.uuid(),
  /** A warning to me, or the outcome of a report I sent (phase 37). */
  kind: z.enum(['warning', 'report_reviewed', 'appeal_decided']),
  category: z.enum(reportCategories),
  /**
   * report_reviewed: whether something was done (never which action). appeal_decided (phase 61):
   * whether the decision was reversed.
   */
  outcome: z.enum(['actioned', 'dismissed', 'upheld', 'reversed']).optional(),
  /** warning, appeal_decided: the decision, to open its statement (phase 61). */
  decisionId: z.uuid().optional(),
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

/**
 * Phase 61, the ground for a decision (DSA Art. 17(3)(d)): the community's rules, or the law. ⚖️
 * Which law is for the operator to name in the explanation.
 */
export const moderationGrounds = ['terms', 'illegal'] as const;
export type ModerationGround = (typeof moderationGrounds)[number];

export const MIN_DECISION_EXPLANATION = 10;
export const MAX_DECISION_EXPLANATION = 1000;

export const resolveReportSchema = z
  .object({
    action: z.enum(moderationActions),
    /** Internal note for the audit trail; never shown to the member. */
    reason: z.string().trim().min(3).max(500),
    ground: z.enum(moderationGrounds).default('terms'),
    /** Phase 61: the facts, for the member (statement of reasons). Required unless dismissing. */
    explanation: z.string().trim().max(MAX_DECISION_EXPLANATION).optional(),
  })
  .refine(
    (r) => r.action === 'dismiss' || (r.explanation?.length ?? 0) >= MIN_DECISION_EXPLANATION,
    { message: 'Explain the decision to the member.', path: ['explanation'] },
  );

// ---------------------------------------------------------------------------
// Decisions about my account and appeals (phase 61)
// ---------------------------------------------------------------------------

/** DSA Art. 20(1): at least six months after the decision. */
export const APPEAL_WINDOW_DAYS = 183;
export const MIN_APPEAL_TEXT = 10;
export const MAX_APPEAL_TEXT = 1000;
export const MAX_APPEAL_RESPONSE = 1000;

export const appealableActions = ['warn', 'suspend', 'ban'] as const;
export type AppealableAction = (typeof appealableActions)[number];
export const appealStatuses = ['open', 'upheld', 'reversed'] as const;
export type AppealStatus = (typeof appealStatuses)[number];

/** The last day an appeal can be made for a decision taken at `decidedAt`. */
export function appealDeadline(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export const appealInputSchema = z.object({
  text: z.string().trim().min(MIN_APPEAL_TEXT).max(MAX_APPEAL_TEXT),
});

/** A statement of reasons, as the member reads it: never the internal note or who decided. */
export const decisionSchema = z.object({
  id: z.uuid(),
  action: z.enum(appealableActions),
  category: z.enum(reportCategories).nullable(),
  ground: z.enum(moderationGrounds),
  /** Null for decisions taken before phase 61. */
  explanation: z.string().nullable(),
  /** Found by an automatic check (phase 21, 34); a person always decides. */
  automatedDetection: z.boolean(),
  createdAt: z.string(),
  /** Withdrawn after an appeal. */
  reversed: z.boolean(),
  appealUntil: z.string(),
  canAppeal: z.boolean(),
  appeal: z
    .object({
      status: z.enum(appealStatuses),
      createdAt: z.string(),
      decidedAt: z.string().nullable(),
      response: z.string().nullable(),
    })
    .nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const decisionsSchema = z.object({ decisions: z.array(decisionSchema) });

export const appealSummarySchema = z.object({
  id: z.uuid(),
  status: z.enum(appealStatuses),
  createdAt: z.string(),
  text: z.string(),
  member: z.object({ id: z.string(), displayName: z.string().nullable(), status: z.string() }),
  decision: z.object({
    id: z.uuid(),
    action: z.enum(appealableActions),
    category: z.enum(reportCategories).nullable(),
    ground: z.enum(moderationGrounds),
    explanation: z.string().nullable(),
    /** The internal note (staff only). */
    reason: z.string(),
    automatedDetection: z.boolean(),
    staffName: z.string().nullable(),
    reportId: z.uuid().nullable(),
    createdAt: z.string(),
  }),
  /** This staff member may decide it (not their own decision, unless the only admin). */
  canDecide: z.boolean(),
  decidedAt: z.string().nullable(),
  response: z.string().nullable(),
});
export type AppealSummary = z.infer<typeof appealSummarySchema>;

export const decideAppealSchema = z.object({
  reverse: z.boolean(),
  /** Shown to the member. */
  response: z.string().trim().min(MIN_DECISION_EXPLANATION).max(MAX_APPEAL_RESPONSE),
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
  /** Phase 30: the sender unsent it; added automatically. */
  unsent: z.boolean(),
  sentAt: z.string(),
});

export const moderationHistorySchema = z.object({
  action: z.enum([...moderationActions, 'unsuspend']),
  category: z.enum(reportCategories).nullable(),
  reason: z.string(),
  /** Phase 61: what the member was told, and whether an appeal reversed it. */
  explanation: z.string().nullable(),
  reversed: z.boolean(),
  staffName: z.string().nullable(),
  createdAt: z.string(),
});

export const reportDetailSchema = reportSummarySchema.extend({
  details: z.string().nullable(),
  reporter: z.object({ id: z.string().nullable(), displayName: z.string().nullable() }),
  /** 28d: sent by a member of this partner community (the reporter is unknown here). */
  partnerCommunity: z.string().nullable(),
  /** Opened by an automatic check (photos, phase 21; behaviour and copied text, phase 34). */
  automatic: z.boolean(),
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
  /** Phase 64: staff access to member data only. */
  only: z.enum(['staff_access']).optional(),
});

/** Retention (see docs/phases/PHASE-4.md). Requires legal review per instance. */
export const RESOLVED_REPORT_RETENTION_DAYS = 365;
export const MODERATION_LOG_RETENTION_DAYS = 730;
export const VERIFICATION_RECORD_RETENTION_DAYS = 730;

/** Security audit trail retention (see docs/PRIVACY.md). ⚖️ */
export const AUDIT_LOG_RETENTION_DAYS = 730;
/** Warning period before an inactive account is deleted (when the operator enables it). */
export const INACTIVITY_NOTICE_DAYS = 30;

/**
 * Dashboard → Overview (phase 36): counts only, no names or ids. Hours are whole hours; medians and
 * ages are null when there is nothing to measure.
 */
export const OVERVIEW_DAYS = 7;
export const safetyOverviewSchema = z.object({
  open: z.object({
    total: z.number().int(),
    byPriority: z.record(z.enum(reportPriorities), z.number().int()),
    byCategory: z.record(z.string(), z.number().int()),
    oldestHours: z.number().int().nullable(),
  }),
  recent: z.object({
    days: z.number().int(),
    fromMembers: z.number().int(),
    automatic: z.number().int(),
    automaticByReason: z.record(z.string(), z.number().int()),
    resolved: z.number().int(),
    medianResolveHours: z.number().int().nullable(),
    newAccounts: z.number().int(),
    suspensions: z.number().int(),
  }),
  verificationsWaiting: z.number().int(),
  /** Phase 61. */
  appealsWaiting: z.number().int(),
});
export type SafetyOverview = z.infer<typeof safetyOverviewSchema>;

// ---------------------------------------------------------------------------
// Phase 68c: new profiles approved by hand (when the community turns it on)
// ---------------------------------------------------------------------------

export const profileReviewStatuses = ['approved', 'pending', 'changes'] as const;
export type ProfileReviewStatus = (typeof profileReviewStatuses)[number];
/** What a moderator asks the member to change. */
export const profileReviewReasons = ['photos', 'about', 'answers', 'other'] as const;
export type ProfileReviewReason = (typeof profileReviewReasons)[number];
export const MAX_REVIEW_NOTE = 300;

export const profileReviewSchema = z.object({
  status: z.enum(profileReviewStatuses),
  reason: z.enum(profileReviewReasons).nullable(),
  note: z.string().nullable(),
});
export type ProfileReview = z.infer<typeof profileReviewSchema>;

export const reviewDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }).strict(),
  z
    .object({
      decision: z.literal('changes'),
      reason: z.enum(profileReviewReasons),
      note: z
        .string()
        .trim()
        .min(1)
        .max(MAX_REVIEW_NOTE)
        .refine(
          // eslint-disable-next-line no-control-regex -- matching control characters is the point
          (v) => !/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F<>]/.test(v),
          'Plain text only',
        )
        .nullable(),
    })
    .strict(),
]);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

/** A profile waiting in the queue: what any member would see, no email or place. */
export const pendingProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  age: z.number().int(),
  gender: z.string(),
  intention: z.string(),
  bio: z.string().nullable(),
  prompts: z.array(z.object({ promptKey: z.string(), answer: z.string() })),
  photoIds: z.array(z.uuid()),
  /** Sent again after changes were asked. */
  resubmitted: z.boolean(),
  since: z.string(),
});
export type PendingProfile = z.infer<typeof pendingProfileSchema>;
export const pendingProfilesSchema = z.object({ profiles: z.array(pendingProfileSchema) });
