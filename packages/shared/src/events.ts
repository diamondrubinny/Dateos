import { z } from 'zod';
import { venueSchema } from './dates.js';

/** Community events (phase 14): see docs/phases/PHASE-14.md. */
export const eventStatuses = ['scheduled', 'cancelled'] as const;
export type EventStatus = (typeof eventStatuses)[number];
/** Going, or on the waiting list of a full event (phase 16). */
export const rsvpStatuses = ['going', 'waiting'] as const;
export type RsvpStatus = (typeof rsvpStatuses)[number];
/** At most this many people wait for one event. */
export const MAX_EVENT_WAITLIST = 500;

export const MAX_EVENT_HOURS = 24;
export const MAX_EVENT_CAPACITY = 10_000;
/** People going get a reminder this long before the start. */
export const EVENT_REMINDER_HOURS = 24;
/** Who said they're going is deleted this long after the event ends. ⚖️ */
export const RSVP_RETENTION_DAYS = 30;
/** Ended events (no personal data) are deleted after this. */
export const EVENT_RETENTION_DAYS = 365;

const title = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[^\p{Cc}]*$/u, 'Use a single line of text.');
const description = z.string().trim().max(1000);
const capacity = z.number().int().min(2).max(MAX_EVENT_CAPACITY).nullable();

const window = (v: { startsAt?: string | undefined; endsAt?: string | undefined }) => {
  if (!v.startsAt || !v.endsAt) return true;
  const hours = (Date.parse(v.endsAt) - Date.parse(v.startsAt)) / 3_600_000;
  return hours > 0 && hours <= MAX_EVENT_HOURS;
};
const windowMessage = {
  message: `The end must be after the start, at most ${MAX_EVENT_HOURS} hours later.`,
  path: ['endsAt'],
};

export const eventInputSchema = z
  .object({
    title,
    description: description.default(''),
    venueId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity: capacity.default(null),
  })
  .strict()
  .refine(window, windowMessage);
export type EventInput = z.input<typeof eventInputSchema>;

export const eventUpdateSchema = z
  .object({
    title,
    description,
    venueId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.')
  .refine(window, windowMessage);
export type EventUpdate = z.infer<typeof eventUpdateSchema>;

/** What a member sees. Only the number of people going, never who. */
export const eventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  /** Null if the place was removed since. */
  venue: venueSchema.omit({ id: true }).nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(eventStatuses),
  capacity: z.number().int().nullable(),
  going: z.number().int(),
  full: z.boolean(),
  /** Whether the viewer said they're going. */
  mine: z.boolean(),
  /** How many people are on the waiting list (a count, never who). */
  waitingCount: z.number().int(),
  /** The viewer's place: null if not waiting, else how many people are ahead of them. */
  waitingAhead: z.number().int().nullable(),
});
export type CommunityEvent = z.infer<typeof eventSchema>;

/** Staff view: the venue id for editing, and when it was created. Still no attendee identities. */
export const adminEventSchema = eventSchema.omit({ mine: true, waitingAhead: true }).extend({
  venueId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type AdminEvent = z.infer<typeof adminEventSchema>;
