# Phase 71e: Community organizers (v1.55)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 71 (Events 2.0), part 6: organizers from
> the community, recognized by the events they ran (Pie's creator fund; Israeli singles-event
> organizers). The last part of Events 2.0.

## What's here today (checked in the code)

- Only staff (admins) create events (phase 14) and answer at the event board (phase 27).
- Matchmakers (phase 68a) show the pattern for a member role granted by an admin: a table,
  granted by email, revocable, audited.

## What changes

| Part                    | Change                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Appointing (admins)     | Dashboard → Events → "Community organizers": an admin makes an active member an organizer by email, or takes it back. Audited.                                                                                                       |
| Proposing (organizers)  | Events → "Organize an event": an organizer proposes an in-person event at one of the community's places (title, description, place, time, capacity). At most 5 waiting at a time; a waiting proposal can be withdrawn.               |
| Approving (admins)      | Proposals wait in the dashboard; an admin approves (the event is published as staff events are, with the organizer on it) or declines with a reason the organizer sees. Audited. Admins can edit or cancel the event like any other. |
| Running it (organizers) | For their own events: post updates, answer questions (still without seeing who asked), and show the check-in code at the door. Nothing else: no list of who's going, no dashboard access.                                            |
| Recognition             | Events show "Organized by {first name}" and how many of their events have already taken place.                                                                                                                                       |
| Taking it back          | Waiting proposals are declined; their upcoming events stay, run by staff, without their name.                                                                                                                                        |

## Security and privacy ⚖️

- An organizer is a member, not staff: no dashboard, no MFA requirement, no access to anyone's
  data. Every organizer action is checked on the server against the event's organizer.
- Their first name is shown on their events (part of agreeing to organize) ⚖️; proposals and
  decisions are kept with the event (or 90 days for declined ones) and in the audit log.

## Tests

- Integration: only admins appoint; only organizers propose; validation (a community place, the
  future, a sensible length); the limit; withdraw; approve → a published event with the organizer;
  decline with a reason; the organizer's board and check-in code only for their own events, never
  someone else's; anonymity of questions; the count on events; taking the role back.
- e2e (en, he): an admin appoints; the organizer proposes in the app; the admin approves in the
  dashboard; members see "Organized by"; the organizer posts an update. axe 0. Screenshots.

## Done

- **Integration** (2, `organizers.test.ts`): only admins appoint (moderators and members refused,
  unknown email 404); only organizers propose; validation (the future, length, a community place);
  5 waiting at most; withdrawing (only my own); admins see who proposed; declining with a reason
  the organizer sees; approving publishes the event with the organizer (once); the board, updates,
  answers and check-in code for her own event only, never someone else's, never questions' askers,
  no dashboard; the count once it took place; the export; taking the role back declines what
  waits, hands upcoming events to staff and removes access; all audited.
- **e2e** `pnpm --dir e2e organizers` (en, he): the admin appoints in the dashboard; the organizer
  proposes in the app; the admin approves; another member sees "Organized by"; the organizer posts
  an update and shows the check-in code. axe 0. Screenshots `185-organize`,
  `admin-12-organizers`, `186-organized-by`.
- Declined proposals are deleted after 90 days (worker).
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- Organizers editing their published events (admins do it), and a push to the organizer when a
  proposal is answered.
