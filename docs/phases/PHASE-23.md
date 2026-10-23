# Phase 23: AI matchmaker and live events (v0.9)

> Status: ✅ done (2026-10-23). Approved as part of the roadmap in
> [COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md).
> 📘 = verify against official docs, ⚖️ = needs legal review.

Three features that others have and we can do better: a matchmaker that talks with you without
scanning your gallery, speed dating over video inside the events you already have, and a trust badge
that needs no face scan: "checked in at an event".

## 23a. Matchmaker chat (like Tinder Chemistry, Bumble Bee; local and opt-in)

- From Profile → "Talk to the matchmaker". A short interview, about 6 questions, one at a time:
  - what you're looking for, how far you'd travel, the ages you'd like to meet, what you enjoy,
    must-haves (smoking, children), and an open "anything else?".
  - Each question has **answer chips** (works with no AI at all) and an optional free-text box.
- In practice the free text is one last, optional question ("anything else, in your own words?").
- **Suggestions, never changes:** at the end it shows a list of proposed changes to your
  preferences, interests and dealbreakers, each with what it is now and what it would be. You tick the
  ones you want and press "Apply". Nothing changes without that.
- **How the AI is used:**
  - Chips map to suggestions with plain rules (`packages/ai/src/matchmaker.ts`), fully testable.
  - Free text, when a model is available, is turned into the **same structured fields** with a JSON
    reply at temperature 0. The reply is validated with zod against the allowed values (interest ids,
    intentions, ranges); anything else is dropped. The model never writes text that's shown to anyone.
  - Only your own answers are sent: never your name, photos, gender, orientation, religion or
    messages. The text is treated as content, never as instructions (as in the coach).
  - A local model (Ollama) is used as is. An external endpoint needs the `ai_cloud` consent, like the
    other AI features; without it, the free-text box says it isn't used and chips still work.
- **Never touched by the matchmaker:** gender, who you're interested in, religion and its
  dealbreaker (sensitive, with their own consents), friends mode.
- **Nothing is stored:** the answers live on the device during the interview. The server keeps no
  transcript; the only lasting effect is the changes you apply.
- Rate limit: 20 interpretations a day per member.

## 23b. Video speed dating (like Tinder Sparks; an event type)

- Admins create an event of type **"Video speed dating"** with a round length (3–10 minutes, default 5) and a capacity (up to 40). It needs video calls to be on.
- **In the event window, attendees who said "going" enter the lobby.** The server makes rounds:
  - It pairs people who **can both see each other** under the usual rules (the same visibility query
    both ways: gender, ages, distance, dealbreakers, blocks, contact hides) and haven't met in an
    earlier round, and who haven't already decided on each other.
  - People who sit a round out are first in line for the next one. Someone who arrives during a
    round with at least 2 minutes left (or whose partner left) is paired into it.
  - A round is a 1:1 video room, end-to-end encrypted like video dates. It ends for both at the same
    time.
- **After each round, each person privately answers "Would you like to match?"** Only a mutual yes
  creates a match (dating); nobody learns about a no. Answers can be given until 1 hour after the
  event ends.
- **Safety:** report and leave at any moment; a report or block ends the round and the pair is never
  paired again. A member in the lobby must be active and not suspended; heartbeats every 15 seconds
  drop people who left.
- The lobby shows only counts ("12 here, next round in 0:40"), never who is there.

## 23c. Event check-in and "Checked in at an event" badge

- Admins open "Check-in" on an event in the dashboard. It shows a **QR code that changes every 30
  seconds** (and the same 6-digit code in text), to show on a screen at the venue. A printed or
  forwarded photo of the code stops working within a minute.
- Members scan it with the camera (it opens the app at the event) or type the 6 digits on the event
  page. It works from 30 minutes before the start until the end, only with a "going" RSVP.
- **The badge, opt-in (off by default):** "Checked in at an event", next to "Verified" and "Met in
  person". Only yes or no: never which event, how many, or when.
- It's a trust signal that needs no face scan: someone stood at the venue during the event.

## API (new)

| Method and path                                                        | Who                        | What                                                           |
| ---------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------- |
| `GET /v1/me/matchmaker`                                                | member                     | The questions, and whether free text can be interpreted        |
| `POST /v1/me/matchmaker/suggest`                                       | member, 20/day             | `{ answers }` → suggested changes (nothing is saved)           |
| `POST /v1/me/matchmaker/apply`                                         | member                     | The chosen suggestions, validated again and applied            |
| `POST /v1/events/:id/check-in`                                         | member with a "going" RSVP | `{ code }`; 10 tries an hour                                   |
| `GET /v1/admin/events/:id/check-in`                                    | admin                      | The current code and when it changes                           |
| `PUT /v1/me/event-badge`                                               | member                     | `{ on }`                                                       |
| `POST /v1/events/:id/speed/lobby`, `DELETE /v1/events/:id/speed/lobby` | member with a "going" RSVP | Enter (and heartbeat) or leave the lobby                       |
| `GET /v1/events/:id/speed`                                             | in the lobby               | Counts, my current round, my rounds to answer                  |
| `POST /v1/speed-dates/:id/join`, `POST /v1/speed-dates/:id/leave`      | one of the two             | A LiveKit token (E2EE public key, as in calls), or leave early |
| `POST /v1/speed-dates/:id/answer`                                      | one of the two             | `{ yes }`; a mutual yes returns the match                      |
| `POST /v1/admin/events` (and `PATCH`): `kind`, `roundMinutes`          | admin                      | Speed-dating events                                            |

## Data (new)

- `events.kind` (`standard` | `speed`), `events.round_minutes`.
- `event_rsvps.checked_in_at`; `events.check_in_secret` (random, 32 bytes, never sent to members).
- `profiles.event_check_in_at`: the latest check-in, so the badge outlives the RSVPs (deleted 30
  days after an event); only "in the last 12 months" is ever shown.
- `preferences.show_event_badge` (default false).
- `speed_lobby`: event, member, last seen.
- `speed_dates`: event, round, the two members, room, starts, ends, each one's answer, ended early by.
- Retention: speed dates deleted 30 days after the event (with RSVPs); a match made from them is a
  normal match.

## Security and privacy

- Check-in codes: HMAC-SHA256 of the event secret and the 30-second window, 6 digits; the current and
  previous windows are accepted; compared in constant time; rate-limited.
- Speed dating: every endpoint checks that the member is one of the two; the pairing runs only the
  visibility query; LiveKit identities are roles, never user ids; rooms are deleted at the end.
- Matchmaker: no transcript stored, no data beyond the member's own answers; output validated
  against fixed lists; sensitive fields are out of scope.
- ⚖️ The badge reveals that a person attended some event of this community; it's opt-in and says
  nothing more.

## Decisions (recommended, adopted)

1. The matchmaker suggests and you apply; chips work without any AI; the model only fills fixed
   fields.
2. Speed dating is an event type, video only, at most 40 people, pairing with the usual visibility
   rules both ways; only a mutual yes makes a match.
3. Check-in by a rotating QR or 6-digit code at the venue; the badge is opt-in and only yes or no.

## Results

- **Unit tests:**
  - The matchmaker's rules (`packages/ai/test/matchmaker.test.ts`, 7): taps become changes, nothing
    is suggested where nothing would change, ages stay within 18-100, interests within the limit; the
    model's reply is checked field by field (a "gender" key or an unknown interest is dropped); text
    with a phone number is never sent; a failing model returns nothing.
  - Pairing and check-in codes (`apps/api/test/speed.test.ts`, 6): the person with the fewest
    options chooses first (so fewer sit out), people who sat out go first, codes change every window
    and depend on the secret.
  - Event input: speed dating needs a capacity of at most 40 and rounds of 3-10 minutes.
- **Integration tests (`live-events.test.ts`, 7):**
  - Check-in: admins only see the code; too early is refused; a wrong code, a malformed one and a
    member without an RSVP are refused; the previous window's code still works, an older one doesn't;
    the badge is off by default, shows when turned on, and is gone after 12 months; the export has it.
  - The secret never reaches members.
  - The matchmaker: taps plus free text read by a (fake, local) model, the model's "gender" dropped,
    nothing about the member's name sent, only the chosen changes applied, sensitive fields refused;
    an external model without the AI consent isn't called and taps still work.
  - Speed dating: needs video calls and a capacity of at most 40; only "going" members, only around
    the event; four people, two rounds, pairs that follow everyone's "interested in"; a late arrival
    joins the running round; a token only for the two; a mutual yes makes a match, a no reveals
    nothing; leaving ends the round for both; nobody meets the same person twice; a block ends the
    round; the export has only your own answers; the worker deletes rounds with the RSVPs.
  - Someone outside the other's ages is never paired.
  - The full suite: **192/192**.
- **e2e `pnpm --dir e2e live-events` in en/he/ar/ru, through a real LiveKit server:**
  - The matchmaker with taps; a suggestion unticked; only the chosen changes applied.
  - Video speed dating in two browsers (fake cameras): the lobby, a round, end-to-end encrypted, the
    camera off until turned on, leaving early, a private yes from both, the match.
  - Check-in from the QR link with the code filled in; the opt-in badge on the profile.
  - The dashboard's check-in panel (en/he) with the QR code and the count.
  - axe: 0 WCAG 2.1 AA violations.
- **Found and fixed while testing:**
  - People arriving a little late waited a whole round; now they join the running round.
  - The dashboard's check-in panel was at the bottom of the page; it's at the top now, for showing
    at the venue.
  - Event times read backwards in Hebrew and Arabic ("06:30–05:30"); the range is now isolated
    left-to-right.
- Screenshots `85-matchmaker`, `86-matchmaker-suggestions`, `87-speed-event`, `88-speed-round`,
  `89-speed-match`, `90-check-in`, `91-event-badge`, and in the dashboard `admin-13-check-in`.
- **Still to check:**
  - ⚖️ The badge says someone attended this community's events; keeping the latest check-in time for
    it.
  - 📘 Scanning the QR code with the native camera on real devices, and video speed dating on iOS
    and Android.
  - Captions aren't offered in speed-dating rounds yet (they are in video dates).
