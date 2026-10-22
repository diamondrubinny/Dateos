# Phase 12: Date planner with community places (v0.3, part 2)

> Status: ✅ done (2026-10-22). 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: two people who matched can agree on a first date in a **public place the community trusts**,
in the chat, in two taps, and turn the agreed date into a safety check-in.

Why curated places and not a maps service: an external places API would receive members' locations
and searches (a privacy and cost problem), and it can suggest any address, including someone's home.
A short list kept by the community's own staff (cafés, parks, museums they know) avoids both, works
offline from any vendor, and fits the "your community, your rules" idea.

## 1. Places (staff)

| Field     | Notes                                                                          |
| --------- | ------------------------------------------------------------------------------ |
| Name      | Up to 80 characters                                                            |
| Area      | Neighbourhood or town, up to 80 ("Jaffa", "Haifa – Carmel")                    |
| Category  | café, restaurant, bar, park, museum, activity, other                           |
| Address   | Up to 160 characters, shown to both people once a date is proposed             |
| Note      | Optional, up to 300 ("busy until late, staff know our community")              |
| Step-free | Yes / no: accessible entrance and toilets (shown as a badge)                   |
| Active    | Inactive places disappear for members; existing date cards keep their own copy |

Admins add, edit and deactivate places in the dashboard (moderators can see them). Every change is in
the audit log. No coordinates are stored.

API: `GET /v1/venues` (members: active places), `GET/POST /v1/admin/venues`,
`PATCH /v1/admin/venues/:id` (admin only for writes).

## 2. Date ideas in the chat

- In a chat, **Plan a date** opens a screen: pick a place (filter by category, step-free badge), a
  day (the next 14 days), a time, and an optional short note. It is sent as a **date card** in the
  conversation, with a copy of the place's details (later edits to the place don't change it).
- The other person can **Accept** or **Not this time**; the proposer can **Cancel**. Either person can
  cancel an accepted date before it starts. Status changes update the card live for both.
- After a date is accepted, both see **Set up a safety check-in**, which opens the check-in form
  already filled in (the match, "place, area", the start time).
- Rules: participants of an active match only; at most one open proposal per chat; the time must be
  at least 30 minutes ahead and at most 60 days; the note passes the same harm check as messages (a
  hurtful note is refused); 20 proposals per person per day.
- The card's text (place, time, note) is also stored as the message body, so reports include it as
  evidence and the chat list shows "Date idea: …".

API: `POST /v1/matches/:id/dates` `{ venueId, startsAt, note?, clientId }`,
`POST /v1/dates/:id/accept`, `POST /v1/dates/:id/decline`, `POST /v1/dates/:id/cancel`.
Messages get a new kind `date` with a `date` view (place, time, note, status, who proposed).

## 3. Privacy and safety

- Data: the date plan (place copy, time, note, status) belongs to the chat: deleted with it (the
  existing 30-day purge after an unmatch) or with either account; included in "Download my data".
- Nothing is shared outside the two people; no location of either member is used or stored.
- Threats: using notes to harass → harm check and normal reporting; spamming proposals → one open
  proposal per chat and a daily limit; luring to a private address → only staff-curated places.

## Tests

Integration: venues (members read active only; members and moderators can't write; admin CRUD with
audit; validation), proposals (participants only, IDOR on accept/decline/cancel, only the other
person accepts, one open proposal, time window, inactive venue, hurtful note 422, snapshot kept after
the venue changes, card in both people's message lists with live status), export, purge. Unit: input
schemas and the card summary in four languages. E2E: an admin adds places in the dashboard, A
proposes, B accepts live, A opens the pre-filled check-in, in four languages with axe; screenshots.

## Results

| Check             | Result                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration tests | **126** (7 new: admin-only places with audit, validation, the card both people see with the place copy, every rule, accept/decline/cancel permissions and IDOR, the time window, evidence, export, purge) |
| Unit tests        | shared 32 (venue and proposal schemas, the evidence summary), mobile 18 (four languages, same keys and placeholders)                                                                                      |
| E2E               | An admin adds a place in the dashboard (English, Hebrew); a member proposes, the other accepts live, the check-in opens filled in, in **all four languages**; axe-core: **0** violations                  |
| Screenshots       | `docs/screenshots/<locale>/44–47`, `admin-08-venues`, `showcase-date-planner-<locale>.png`                                                                                                                |

## Bugs found and fixed

1. Report evidence copied only text and voice messages, so a date card would have been missing from
   a report; it is now kept as its plain-text summary.
2. Places have no link to members, so the test reset didn't clear them between tests.
3. The chat header cut off "Report" in Arabic (and with large text); it now wraps to a second line.
4. The check-in prefill joined place and area with a Latin comma in Arabic; the separator is now
   part of each translation (،).
5. A check-in set up days before a date showed only the time; it now shows the day too.

## Known limitations

- Places are a flat list (up to 500) without search or a map; enough for one community.
- Times are chosen in 15-minute steps between 09:00 and 22:45.

## Next (phase 13)

Community events: staff publish events (speed dating evening, picnic), members RSVP, an attendee
count without a public guest list.
