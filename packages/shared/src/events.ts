// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { venueSchema } from './dates.js';
import { allStreams } from './faith.js';
import { genders } from './profile.js';

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

/** A regular event, or video speed dating (phase 23). */
export const eventKinds = ['standard', 'speed'] as const;
export type EventKind = (typeof eventKinds)[number];
export const SPEED_ROUND_MIN = 3;
export const SPEED_ROUND_MAX = 10;
export const SPEED_ROUND_DEFAULT = 5;
/** Speed dating is small by design: everyone can meet a good share of the room. */
export const MAX_SPEED_CAPACITY = 40;

const title = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[^\p{Cc}]*$/u, 'Use a single line of text.');
const description = z.string().trim().max(1000);
const capacity = z.number().int().min(2).max(MAX_EVENT_CAPACITY).nullable();
const roundMinutes = z.number().int().min(SPEED_ROUND_MIN).max(SPEED_ROUND_MAX);

const window = (v: { startsAt?: string | undefined; endsAt?: string | undefined }) => {
  if (!v.startsAt || !v.endsAt) return true;
  const hours = (Date.parse(v.endsAt) - Date.parse(v.startsAt)) / 3_600_000;
  return hours > 0 && hours <= MAX_EVENT_HOURS;
};
const windowMessage = {
  message: `The end must be after the start, at most ${MAX_EVENT_HOURS} hours later.`,
  path: ['endsAt'],
};

// ---------------------------------------------------------------------------
// Phase 71b: who an event is for, and places by gender
// ---------------------------------------------------------------------------

export const EVENT_AGE_MIN = 18;
export const EVENT_AGE_MAX = 99;
export const MAX_EVENT_REPEAT_WEEKS = 12;

/** Who may take a place (all optional; empty means everyone). */
export const eventAudienceSchema = z
  .object({
    genders: z.array(z.enum(genders)).max(genders.length).default([]),
    ageMin: z.number().int().min(EVENT_AGE_MIN).max(EVENT_AGE_MAX).nullable().default(null),
    ageMax: z.number().int().min(EVENT_AGE_MIN).max(EVENT_AGE_MAX).nullable().default(null),
    /** Only with the faith module on; matched against a stream given with the religion consent. */
    faithStreams: z.array(z.enum(allStreams)).max(allStreams.length).default([]),
  })
  .strict()
  .refine((a) => a.ageMin === null || a.ageMax === null || a.ageMin <= a.ageMax, {
    message: 'The youngest age must not be above the oldest.',
    path: ['ageMax'],
  });
export type EventAudience = z.output<typeof eventAudienceSchema>;

/** Places by gender, e.g. 12 women and 12 men; each with its own waiting list. */
export const eventPoolSchema = z
  .object({ gender: z.enum(genders), capacity: z.number().int().min(1).max(MAX_EVENT_CAPACITY) })
  .strict();
export const eventPoolsSchema = z
  .array(eventPoolSchema)
  .min(2)
  .max(genders.length)
  .refine((pools) => new Set(pools.map((p) => p.gender)).size === pools.length, {
    message: 'Each gender once.',
  })
  .nullable();
export type EventPool = z.infer<typeof eventPoolSchema>;

/** Why the viewer can't take a place, if they can't. */
export const notForYouReasons = ['gender', 'age', 'faith'] as const;
export type NotForYouReason = (typeof notForYouReasons)[number];

export const eventRepeatSchema = z
  .object({ weeks: z.number().int().min(1).max(MAX_EVENT_REPEAT_WEEKS) })
  .strict();

export const eventInputSchema = z
  .object({
    title,
    description: description.default(''),
    venueId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity: capacity.default(null),
    kind: z.enum(eventKinds).default('standard'),
    roundMinutes: roundMinutes.nullable().default(null),
    audience: eventAudienceSchema.optional(),
    pools: eventPoolsSchema.default(null),
  })
  .strict()
  .refine(window, windowMessage)
  .refine(
    (v) => {
      if (v.kind !== 'speed') return true;
      // Phase 71b: with places by gender, the capacity is their sum.
      const total = v.pools ? v.pools.reduce((n, p) => n + p.capacity, 0) : v.capacity;
      return total !== null && total <= MAX_SPEED_CAPACITY;
    },
    {
      message: `Speed dating needs a capacity of at most ${MAX_SPEED_CAPACITY}.`,
      path: ['capacity'],
    },
  );
export type EventInput = z.input<typeof eventInputSchema>;

export const eventUpdateSchema = z
  .object({
    title,
    description,
    venueId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity,
    roundMinutes,
    audience: eventAudienceSchema,
    pools: eventPoolsSchema,
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
  kind: z.enum(eventKinds),
  /** Speed dating only: the length of each round. */
  roundMinutes: z.number().int().nullable(),
  /** Whether the viewer checked in at the venue (phase 23). */
  checkedIn: z.boolean(),
  /** Phase 71b: who it's for (empty lists and nulls: everyone). */
  audience: z.object({
    genders: z.array(z.enum(genders)),
    ageMin: z.number().int().nullable(),
    ageMax: z.number().int().nullable(),
    faithStreams: z.array(z.string()),
  }),
  /** Phase 71b: places by gender, with counts (never who). */
  pools: z
    .array(
      z.object({
        gender: z.enum(genders),
        capacity: z.number().int(),
        going: z.number().int(),
        waiting: z.number().int(),
      }),
    )
    .nullable(),
  /** Phase 71b: why the viewer can't take a place, or null if they can. */
  notForYou: z.enum(notForYouReasons).nullable(),
  /**
   * Phase 71a: "Meet again" is open for the viewer until this time (they checked in at an
   * in-person event that ended less than MEET_AGAIN_HOURS ago), else null.
   */
  meetAgainUntil: z.string().nullable(),
});
export type CommunityEvent = z.infer<typeof eventSchema>;

/** Staff view: the venue id for editing, and when it was created. Still no attendee identities. */
export const adminEventSchema = eventSchema
  .omit({
    mine: true,
    waitingAhead: true,
    checkedIn: true,
    meetAgainUntil: true,
    notForYou: true,
  })
  .extend({
    venueId: z.uuid().nullable(),
    createdAt: z.string(),
    /** How many people checked in (a count). */
    checkedInCount: z.number().int(),
  });
export type AdminEvent = z.infer<typeof adminEventSchema>;

// ---------------------------------------------------------------------------
// Check-in at the venue (phase 23)
// ---------------------------------------------------------------------------

/** The code on the venue's screen changes this often; the previous one is still accepted. */
export const CHECK_IN_STEP_SECONDS = 30;
/** Check-in opens this long before the start, and closes at the end. */
export const CHECK_IN_EARLY_MINUTES = 30;
/** The badge shows check-ins from the last 12 months. */
export const EVENT_BADGE_MONTHS = 12;

export const checkInSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export const adminCheckInSchema = z.object({
  code: z.string(),
  /** What the QR code opens: the event page, with the code. */
  url: z.string(),
  changesAt: z.string(),
  checkedInCount: z.number().int(),
});
export type AdminCheckIn = z.infer<typeof adminCheckInSchema>;

// ---------------------------------------------------------------------------
// Video speed dating (phase 23)
// ---------------------------------------------------------------------------

/** Heartbeats keep you in the lobby; without one for this long, you're out. */
export const SPEED_HEARTBEAT_SECONDS = 15;
export const SPEED_LOBBY_TIMEOUT_SECONDS = 40;
/** The pause between rounds, to answer and get ready. */
export const SPEED_BREAK_SECONDS = 45;
/** During a round with at least this long left, people who are waiting are paired into it. */
export const SPEED_LATE_JOIN_SECONDS = 120;
/** Answers can still be given this long after the event ends. */
export const SPEED_ANSWER_HOURS = 1;

export const speedDateSchema = z.object({
  id: z.uuid(),
  round: z.number().int(),
  /** The other person: first name only, as on a card. */
  with: z.object({ id: z.string(), displayName: z.string(), age: z.number().int() }),
  startsAt: z.string(),
  endsAt: z.string(),
  /** Live now, over, or ended early by one of the two. */
  status: z.enum(['live', 'over']),
  /** My answer, if I gave one. */
  answer: z.boolean().nullable(),
  /** Set when both said yes. */
  matchId: z.uuid().nullable(),
});
export type SpeedDate = z.infer<typeof speedDateSchema>;

export const speedStateSchema = z.object({
  /** Whether I'm in the lobby now. */
  inLobby: z.boolean(),
  /** How many people are in the lobby (a count, never who). */
  here: z.number().int(),
  /** When the next round starts, if the event is on. */
  nextRoundAt: z.string().nullable(),
  /** Whether the event is on now (between the start and the end). */
  live: z.boolean(),
  current: speedDateSchema.nullable(),
  /** Rounds I took part in, newest first. */
  past: z.array(speedDateSchema),
});
export type SpeedState = z.infer<typeof speedStateSchema>;

export const speedAnswerSchema = z.object({ yes: z.boolean() }).strict();

export const speedJoinSchema = z.object({
  url: z.string(),
  token: z.string(),
  /** The LiveKit room name (part of the end-to-end key derivation). */
  room: z.string(),
  date: speedDateSchema,
});
export type SpeedJoin = z.infer<typeof speedJoinSchema>;

// ---------------------------------------------------------------------------
// Updates and questions to the organizers (phase 27)
// ---------------------------------------------------------------------------

export const MAX_EVENT_UPDATE_LENGTH = 500;
export const MAX_EVENT_QUESTION_LENGTH = 500;
export const MAX_EVENT_ANSWER_LENGTH = 1000;
/** Open (unanswered) questions one member may have about one event. */
export const MAX_OPEN_EVENT_QUESTIONS = 5;

const text = (max: number) => z.string().trim().min(1).max(max);

/** An update from the organizers, for people going or waiting. No author is shown. */
export const eventNoticeSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: z.string(),
});
export type EventNotice = z.infer<typeof eventNoticeSchema>;

/** A question to the organizers. Staff see it without who asked. */
export const eventQuestionSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  answer: z.string().nullable(),
  answeredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type EventQuestion = z.infer<typeof eventQuestionSchema>;

/** What a member going or waiting sees: the updates and their own questions. */
export const eventBoardSchema = z.object({
  updates: z.array(eventNoticeSchema),
  questions: z.array(eventQuestionSchema),
});
export type EventBoard = z.infer<typeof eventBoardSchema>;

export const eventNoticeInputSchema = z.object({ body: text(MAX_EVENT_UPDATE_LENGTH) }).strict();
export const eventQuestionInputSchema = z
  .object({ body: text(MAX_EVENT_QUESTION_LENGTH) })
  .strict();
export const eventAnswerInputSchema = z.object({ answer: text(MAX_EVENT_ANSWER_LENGTH) }).strict();

// ---------------------------------------------------------------------------
// Phase 71a: "Meet again" after an in-person event, and no-shows
// ---------------------------------------------------------------------------

/** "Meet again" stays open this long after an in-person event ends. */
export const MEET_AGAIN_HOURS = 72;

export const meetAgainPersonSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  /** Whether I chose them (only ever shown to me). */
  picked: z.boolean(),
  /** Set when we both chose each other. */
  matchId: z.uuid().nullable(),
});
export type MeetAgainPerson = z.infer<typeof meetAgainPersonSchema>;

export const meetAgainSchema = z.object({
  /** Whether I joined: only then am I listed to the others, and they to me. */
  joined: z.boolean(),
  closesAt: z.string(),
  people: z.array(meetAgainPersonSchema),
});
export type MeetAgain = z.infer<typeof meetAgainSchema>;

export const meetAgainPickSchema = z.object({ yes: z.boolean() }).strict();

/** Misses counted within this many days (as long as RSVPs are kept). */
export const NO_SHOW_WINDOW_DAYS = RSVP_RETENTION_DAYS;
/** This many misses in the window pause new places... */
export const NO_SHOW_LIMIT = 2;
/** ...for this many days from the latest miss. */
export const NO_SHOW_PAUSE_DAYS = 14;
/** A place from the waiting list given less than this long before the start never counts. */
export const NO_SHOW_LATE_PLACE_HOURS = 24;

export const noShowSchema = z.object({
  eventId: z.uuid(),
  title: z.string(),
  endedAt: z.string(),
  excused: z.boolean(),
});
export type NoShow = z.infer<typeof noShowSchema>;

export const myNoShowsSchema = z.object({
  /** Missed events in the last NO_SHOW_WINDOW_DAYS days, newest first. */
  noShows: z.array(noShowSchema),
  /** New places and waiting lists are paused until then, or null. */
  pausedUntil: z.string().nullable(),
  /** Whether I can still excuse a miss (once in NO_SHOW_WINDOW_DAYS days). */
  canExcuse: z.boolean(),
});
export type MyNoShows = z.infer<typeof myNoShowsSchema>;
