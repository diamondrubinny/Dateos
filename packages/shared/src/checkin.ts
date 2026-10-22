import { z } from 'zod';
import { localeSchema } from './common.js';

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Safety check-in (phase 9): see docs/phases/PHASE-9.md. */
export const CHECKIN_GRACE_MINUTES = 15;
export const CHECKIN_MIN_MINUTES = 15;
export const CHECKIN_MAX_HOURS = 12;
export const CHECKINS_PER_DAY = 5;
export const SOS_PER_CHECKIN = 3;
/** Ended check-ins (and the contact's address) are deleted after this. ⚖️ */
export const CHECKIN_RETENTION_DAYS = 7;

export const checkinStatuses = ['active', 'ok', 'alerted', 'cancelled'] as const;
export type CheckinStatus = (typeof checkinStatuses)[number];

export const checkinInputSchema = z
  .object({
    matchId: z.uuid().optional(),
    place: z.string().trim().min(2).max(200),
    startsAt: z.iso.datetime(),
    checkAt: z.iso.datetime(),
    contactName: z.string().trim().min(1).max(60),
    contactEmail: z.email().max(254),
    note: z.string().trim().max(300).optional(),
    locale: localeSchema,
    /** IANA zone of the member's device, so the email shows local times. */
    timeZone: z.string().max(64).refine(isTimeZone, 'Unknown time zone.'),
  })
  .strict()
  .refine(
    (v) => {
      const minutes = (Date.parse(v.checkAt) - Date.parse(v.startsAt)) / 60_000;
      return minutes >= CHECKIN_MIN_MINUTES && minutes <= CHECKIN_MAX_HOURS * 60;
    },
    {
      message: `The check-in time must be ${CHECKIN_MIN_MINUTES} minutes to ${CHECKIN_MAX_HOURS} hours after the start.`,
      path: ['checkAt'],
    },
  );
export type CheckinInput = z.infer<typeof checkinInputSchema>;

export const checkinSchema = z.object({
  id: z.uuid(),
  status: z.enum(checkinStatuses),
  matchName: z.string().nullable(),
  place: z.string(),
  startsAt: z.string(),
  checkAt: z.string(),
  contactName: z.string(),
  /** Shown masked to the member (n***@example.com); the full address never leaves the server again. */
  contactEmailMasked: z.string(),
  note: z.string().nullable(),
  sosCount: z.number().int(),
});
export type Checkin = z.infer<typeof checkinSchema>;

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

// --------------------------------------------------------------------------- anti-ghosting

/** A conversation counts as waiting for my reply after this long. */
export const GHOSTING_REMINDER_DAYS = 3;
/** The other person sees a "closed kindly" card this long. */
export const CLOSED_CARD_DAYS = 7;
export const MAX_CLOSING_MESSAGE_LENGTH = 300;

export const closeMatchSchema = z
  .object({ message: z.string().trim().min(2).max(MAX_CLOSING_MESSAGE_LENGTH) })
  .strict();

export const closedConversationSchema = z.object({
  matchId: z.uuid(),
  name: z.string(),
  message: z.string(),
  closedAt: z.string(),
});
export type ClosedConversation = z.infer<typeof closedConversationSchema>;

/**
 * True when the other person wrote last and has been waiting at least GHOSTING_REMINDER_DAYS.
 * `lastMessage` is the conversation's latest message from the viewer's point of view.
 */
export function waitingForMyReply(
  lastMessage: { mine: boolean; createdAt: string } | null,
  now: number = Date.now(),
): boolean {
  if (!lastMessage || lastMessage.mine) return false;
  return now - Date.parse(lastMessage.createdAt) >= GHOSTING_REMINDER_DAYS * 86_400_000;
}
