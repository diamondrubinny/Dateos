// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { dateFeedbackViewSchema } from './after-match.js';

/** Date planner (phase 12): see docs/phases/PHASE-12.md. */
export const venueCategories = [
  'cafe',
  'restaurant',
  'bar',
  'park',
  'museum',
  'activity',
  'other',
] as const;
export type VenueCategory = (typeof venueCategories)[number];

export const dateStatuses = ['proposed', 'accepted', 'declined', 'cancelled'] as const;
export type DateStatus = (typeof dateStatuses)[number];

/** A date must be proposed at least this far ahead, and at most DATE_MAX_DAYS_AHEAD days. */
export const DATE_MIN_LEAD_MINUTES = 30;
export const DATE_MAX_DAYS_AHEAD = 60;
export const MAX_DATE_NOTE_LENGTH = 200;
export const DATE_PROPOSALS_PER_DAY = 20;

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // One line of plain text: control characters (line breaks included) would break the card.
    .regex(/^[^\p{Cc}]*$/u, 'Use a single line of text.');

export const venueInputSchema = z
  .object({
    name: line(80),
    area: line(80),
    category: z.enum(venueCategories),
    address: line(160),
    note: z.string().trim().max(300).nullable().default(null),
    stepFree: z.boolean().default(false),
    /** Phase 74b: kosher (staff mark it only with a valid certificate ⚖️), closed on Shabbat. */
    kosher: z.boolean().default(false),
    shabbatClosed: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();
export type VenueInput = z.infer<typeof venueInputSchema>;

export const venueUpdateSchema = z
  .object({
    name: line(80),
    area: line(80),
    category: z.enum(venueCategories),
    address: line(160),
    note: z.string().trim().max(300).nullable(),
    stepFree: z.boolean(),
    kosher: z.boolean(),
    shabbatClosed: z.boolean(),
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type VenueUpdate = z.infer<typeof venueUpdateSchema>;

/** What members see of a place (no internal fields). */
export const venueSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  area: z.string(),
  category: z.enum(venueCategories),
  address: z.string(),
  note: z.string().nullable(),
  stepFree: z.boolean(),
  /** Phase 74b. */
  kosher: z.boolean(),
  shabbatClosed: z.boolean(),
});
export type Venue = z.infer<typeof venueSchema>;

/** Staff view, including inactive places. */
export const adminVenueSchema = venueSchema.extend({
  active: z.boolean(),
  updatedAt: z.string(),
});
export type AdminVenue = z.infer<typeof adminVenueSchema>;

export const proposeDateSchema = z
  .object({
    venueId: z.uuid(),
    startsAt: z.iso.datetime(),
    note: z.string().trim().max(MAX_DATE_NOTE_LENGTH).optional(),
    clientId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[\w-]+$/),
  })
  .strict();
export type ProposeDateInput = z.infer<typeof proposeDateSchema>;

/** "Suggest another time" (phase 46): the same place, a new time (and an optional note). */
export const counterDateSchema = proposeDateSchema.omit({ venueId: true });
export type CounterDateInput = z.infer<typeof counterDateSchema>;

/** The date card as one participant sees it. The place is a copy taken when it was proposed. */
export const datePlanSchema = z.object({
  id: z.uuid(),
  status: z.enum(dateStatuses),
  /** True when the viewer proposed it. */
  mine: z.boolean(),
  venue: venueSchema.omit({ id: true }),
  startsAt: z.string(),
  note: z.string().nullable(),
  respondedAt: z.string().nullable(),
  /** Declined by suggesting another time (phase 46): the next card in the chat is the answer. */
  countered: z.boolean(),
  /** "Did you meet?" (phase 20); null unless the date was accepted. */
  feedback: dateFeedbackViewSchema.nullable(),
});
export type DatePlan = z.infer<typeof datePlanSchema>;

/**
 * Plain-text copy of a date card, stored as the message body so report evidence and the
 * moderation dashboard show what was proposed without knowing about date cards.
 */
export function datePlanSummary(plan: {
  venueName: string;
  venueArea: string;
  startsAt: Date;
  note: string | null;
}): string {
  const when = plan.startsAt.toISOString().slice(0, 16).replace('T', ' ');
  const base = `📅 ${plan.venueName}, ${plan.venueArea} · ${when} UTC`;
  return plan.note ? `${base} · ${plan.note}` : base;
}
