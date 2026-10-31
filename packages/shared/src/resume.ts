// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { aboutSchema } from './about.js';
import { faithSchema } from './faith.js';
import { genderSchema, intentionSchema, promptKeySchema } from './profile.js';

/**
 * Phase 68b: a "matchmaking résumé", shared with one person (a parent, a matchmaker) by a
 * short-lived link the member can end at any time. See docs/phases/PHASE-68.md.
 */
export const MAX_RESUME_LINKS = 5;
export const RESUME_LABEL_MAX = 40;
export const resumeDays = [1, 3, 7] as const;
/** Ended links are deleted this many days later (the worker's retention job). */
export const RESUME_RETENTION_DAYS = 30;

/** What a résumé may show besides the name, age, gender and intention. */
export const resumeSections = ['photo', 'about', 'prompts', 'faith'] as const;
export type ResumeSection = (typeof resumeSections)[number];

const unique = <T>(l: T[]) => new Set(l).size === l.length;

export const resumeLinkInputSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(RESUME_LABEL_MAX)
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      .refine((v) => !/[\u0000-\u001F\u007F<>]/.test(v), 'Plain text only'),
    days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
    sections: z.array(z.enum(resumeSections)).max(resumeSections.length).refine(unique),
  })
  .strict();
export type ResumeLinkInput = z.infer<typeof resumeLinkInputSchema>;

export const resumeLinkSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  sections: z.array(z.enum(resumeSections)),
  createdAt: z.string(),
  expiresAt: z.string(),
  views: z.number().int(),
  lastViewedAt: z.string().nullable(),
});
export type ResumeLink = z.infer<typeof resumeLinkSchema>;

export const resumeLinksSchema = z.object({ links: z.array(resumeLinkSchema) });
/** Shown once, when the link is made: only its hash is kept. */
export const resumeLinkCreatedSchema = resumeLinkSchema.extend({ token: z.string() });

/** The public page: only what the member chose, never email, place or distance. */
export const resumeCardSchema = z.object({
  community: z.string(),
  label: z.string(),
  sharedAt: z.string(),
  expiresAt: z.string(),
  displayName: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  intention: intentionSchema,
  /** A watermarked copy, through this link only. */
  photoUrl: z.string().nullable(),
  bio: z.string().nullable(),
  about: aboutSchema.nullable(),
  prompts: z.array(z.object({ promptKey: promptKeySchema, answer: z.string() })),
  faith: faithSchema.nullable(),
});
export type ResumeCard = z.infer<typeof resumeCardSchema>;

/** The watermark text burned into the photo and shown on the page. */
export function resumeWatermark(label: string, sharedAt: string, expiresAt: string): string {
  return `${label} · ${sharedAt.slice(0, 10)} → ${expiresAt.slice(0, 10)}`;
}
