# Phase 9: Safety check-in and anti-ghosting (v0.3, part 1)

> Status: ✅ done (2026-10-22). 📘 = verify against official docs, ⚖️ = needs legal review.

From the v0.3 list in [PLAN.md](../PLAN.md), the two features that need no new infrastructure.
Video dates (LiveKit + a TURN server) and the date planner (an external places source, which raises
location-privacy questions) get their own plan later.

## 1. Safety check-in

Before meeting someone, a member can set up a check-in:

| Field                | Notes                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| Who                  | Optional: one of the member's active matches (only the first name is shared)           |
| Where                | Free text the member writes ("Café Puaa, Jaffa"); the app never sends a GPS position   |
| Start, check-in time | When the date starts, and when the member expects to be done (15 min – 12 h later)     |
| Trusted contact      | Name and email address of someone the member trusts (no account needed); optional note |

- **"I'm OK"** button at any time ends the check-in. Nothing is sent to the contact.
- **Missed check-in**: 15 minutes after the check-in time, if the member hasn't confirmed, the contact
  gets an email with exactly what the member wrote (place, time, the match's first name, the note) and a
  suggestion to call the member. The member also gets a push "Time to check in" at the check-in time.
- **SOS** button: sends that email at once, marked urgent, and tells the member to call emergency
  services if in danger (the app is not an emergency service).
- **Retention**: the check-in (with the contact's email) is deleted 7 days after it ends ⚖️.
- No email goes to the contact when the check-in is created, so the contact's address is only used if
  the member might be in trouble (the member is told to let the contact know) ⚖️.

API: `POST /v1/me/checkins`, `GET /v1/me/checkins/active`, `POST /v1/me/checkins/:id/ok`,
`POST /v1/me/checkins/:id/sos`, `DELETE /v1/me/checkins/:id` (all owner-only; at most one active
check-in; 5 per day; SOS at most 3 per check-in). Worker: a job every minute sends due alerts
(idempotent: each check-in alerts at most once, SOS at most 3 times).

Threats: someone using check-ins to send spam or harassment to an address → per-member daily limit,
fixed email text with the member's words quoted plainly (no links, HTML escaped), sender is the
community; the contact can't be contacted again after the check-in ends. A suspended member's
active check-ins still alert (safety first).

## 2. Anti-ghosting

- **Gentle reminder**: in the chats list, a conversation where the other person wrote last and is
  waiting for more than 3 days shows "Waiting for your reply" with two actions: reply, or close kindly.
  Computed on the device from the existing inbox; no extra notifications.
- **Close kindly**: one tap picks a polite closing message (3 choices in each language, or the
  member's own words) and unmatches. A closed chat can't be opened any more, so the message is kept on
  the match and the other person sees a card "Noa closed the conversation: …" at the top of their chats
  for 7 days (name and message only, no photo), which they can dismiss. Nobody is left wondering.

API: `POST /v1/matches/:id/close` `{ message }` (participants only, unmatches in one step; the message
passes the same harm checks as any message, and a hurtful one is refused), `GET /v1/matches/closed`,
`POST /v1/matches/:id/closed/dismiss`. Blocking stays silent: no card.

## Tests

Integration: check-in ownership (IDOR), limits, validation, worker alert after the deadline only, at
most once, never after "I'm OK", SOS immediate, email content (no HTML injection, no links), retention
deletion; close-kindly sends and unmatches atomically, only participants, the other side sees the
message and the closed state. Unit: reminder rule. E2E: check-in screens and close-kindly in four
languages with axe.

## Results

| Check             | Result                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests        | shared 27 (check-in input window, time zone, email masking, alert email in four languages with HTML escaping and no links, reminder rule), mobile 18, worker 14, api 38, ai 53 |
| Integration tests | **119** (check-in ownership, limits, one open check-in, SOS limit, worker alert only after the grace period and at most once, never after "I'm OK", retention; close kindly)   |
| E2E               | Check-in form, SOS email checked in Mailpit, "I'm OK", close kindly and the live card on the other side, in **all four languages**; axe-core: **0** violations                 |
| Screenshots       | `docs/screenshots/<locale>/40–43` and `showcase-safety-date-<locale>.png`, in the README and the four marketing pages                                                          |

## Bugs found and fixed

1. Long option labels (chips) overflowed the screen, most visibly in Russian and Arabic; chips now wrap
   and long choices can be shown one per line (`stacked`).
2. The Arabic "Profile" tab label was cut off; now «ملفي».
3. The translation test flagged strings with no words of their own (only a placeholder and quote marks).
4. In Hebrew and Arabic the "SOS: …" button label put the colon on the wrong side (the label began
   with Latin letters in a right-to-left line); both now start in their own script.
5. Wording that assumed a gender, found by reviewing the screenshots: the Arabic alert email and two
   Arabic app texts (masculine verbs for the member or the match, "call her" for the contact), the
   Hebrew intro ("נשלח לו"), and the Russian closed card. Now neutral or inclusive, like the rest.

## Known limitations

- Alerts go by email only (no SMS); the contact is not told in advance unless the member tells them.
  The app is not an emergency service, and says so on the SOS button ⚖️.
- Alerts depend on the worker running and on the instance's email provider; a missed check-in is
  emailed within about a minute of the 15-minute grace period.
- The "waiting for your reply" mark is computed on the device from the last message only.
