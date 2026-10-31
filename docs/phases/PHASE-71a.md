# Phase 71a: "Meet again" after an event, and no-shows (v1.51)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review, 📘 = verify against official docs.
> From `docs/research/market-gaps-2026-10.he.md`, item 71 (Events 2.0), parts 1 and 3. Pools and
> segments (71b) and tables, community organizers and live support (71c) come next.

## What's here today (checked in the code)

- Events (phase 14) are created only by staff; members see counts, never who's going. Staff don't
  see attendee identities either (`adminEventSchema`: "Still no attendee identities").
- Check-in at the venue with a rotating code (phase 23) marks `event_rsvps.checked_in_at`.
- Video speed dating (phase 23) has private yes/no per round; both yes → a match
  (`matchFromSpeedDate`). In-person events have nothing after the event.
- RSVPs (and everything tied to them) are deleted 30 days after the event.

## What changes

| Part                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meet again (members who checked in)     | For **72 hours** after an in-person event ends, a member who checked in can open "Meet again". They're listed to others only after they join it themselves. They see the others who checked in and joined, and only people they could see anyway (both ways: blocks, who they're looking for, a break). They privately mark "I'd like to meet again"; **only a mutual choice** becomes a match (and a chat), like speed dating. A one-sided choice is never shown to anyone and can be taken back. |
| No-shows (only where check-in was used) | Someone "going" who didn't check in, at an event where at least one person checked in, missed it (leaving is possible until the event ends). A place taken from the waiting list less than 24 hours before the start never counts.                                                                                                                                                                                                                                                                 |
| First miss                              | A private note on the Events screen: "We missed you at {event}. If you can't come, leave the event so someone waiting gets the place."                                                                                                                                                                                                                                                                                                                                                             |
| Two misses in 30 days                   | No new places or waiting lists for **14 days** from the latest miss; said privately with the reason and the date it ends. Places already taken stay.                                                                                                                                                                                                                                                                                                                                               |
| Appeal, privately                       | "I was there, or something came up": the member marks one miss as excused, once in 30 days, no questions asked; it no longer counts. Staff see nothing (no list of who missed).                                                                                                                                                                                                                                                                                                                    |
| Retention                               | Choices and joining Meet again go with the RSVPs (30 days after the event), so misses older than 30 days are gone too.                                                                                                                                                                                                                                                                                                                                                                             |

## Security and privacy ⚖️

- Meet again shows only display names (and a link to the profile, which keeps its own access
  rules) of people who both checked in and opted in; never who chose whom.
- Misses are computed from data already kept (RSVP and check-in), never shown to staff or anyone
  else; the freeze is short, explained, and lifted by the member's own statement once a month.
  Whether a freeze needs a DSA statement of reasons is a question for review ⚖️.

## Tests

- Integration: Meet again only for people who checked in, only after the end, only for 72 hours;
  only joined people are listed, never blocked or incompatible ones; one-sided choice shows
  nothing to the other; mutual → match once; un-choosing; speed events excluded. No-shows: none
  where nobody checked in; leaving before the start isn't a miss; late promotion isn't a miss;
  first miss → note; second → frozen (RSVP and waitlist refused) until the date; excusing lifts
  it, once in 30 days; data goes with the RSVPs.
- e2e (en, he): two members check in, after the event both open Meet again, choose each other and
  get a match; a member with two misses sees the freeze and excuses one. axe 0. Screenshots.

## Done

- **Integration** (2, `meet-again.test.ts`): Meet again refused before the end, for people who
  didn't check in, and after 72 hours; listed in Events while open; nobody listed before joining;
  only people both can see (Dan and Gil don't see each other, a block removes); a one-sided choice
  shows nothing to the other; mutual → one match, the same id for both; taking a choice back; the
  export has my choices only; choices deleted with the RSVPs. Misses: none where nobody checked in,
  none for leaving in time or a late place from the waiting list; two → RSVP and waiting list
  refused until 14 days after the latest; leaving after the end refused; one excuse lifts it, a
  second in the month is refused; nothing older than 30 days.
- **e2e** `pnpm --dir e2e meet-again` (en, he): the ended event in the list, joining, choosing,
  a match for both and the chat; missed events paused, one excused. axe 0. Screenshots
  `177-meet-again`, `178-meet-again-match`, `179-event-misses` (en, he).
- Leaving an event is refused once it ended (it would erase the check-in, or a miss).
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- A push when "Meet again" opens, and when both chose (the match notification already says so).
- Pools and segments (71b); tables, community organizers and live support (71c).
