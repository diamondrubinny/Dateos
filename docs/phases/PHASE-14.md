# Phase 14: Community events (v0.3, part 3)

> Status: ✅ done (2026-10-22). 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: the community's team publishes real-world events (a speed-dating evening, a picnic, a walking
tour), members say they're going, and nobody's attendance is shown to other members. Meeting in a
group, in a place the community chose, is the safest first meeting there is.

## 1. Events (staff)

| Field       | Notes                                                                             |
| ----------- | --------------------------------------------------------------------------------- |
| Title       | Up to 80 characters, one line                                                     |
| Description | Up to 1000 characters (line breaks allowed)                                       |
| Place       | One of the community's places (phase 12), so events happen only in curated venues |
| Start, end  | End after start, at most 24 hours long; start in the future when created          |
| Capacity    | Optional, 2 to 10 000; "going" is refused when full                               |
| Status      | Scheduled or cancelled. Cancelling tells everyone who said they're going (push)   |

Admins create, edit and cancel events in the dashboard (moderators can see them, with the number of
people going; never their names). Every change is in the audit log.

API: `GET /v1/admin/events`, `POST /v1/admin/events`, `PATCH /v1/admin/events/:id`,
`POST /v1/admin/events/:id/cancel`.

## 2. Members

- **Events** (from the Profile tab and Matches): upcoming events with date, place, step-free badge and
  "N going". An event page with the description, the place's address and note, and **I'm going** /
  **I can't go after all**.
- Only the count is shown. Who else is going is never shown in the app or the API: members meet at
  the event, not before ⚖️.
- A content-free push the day before ("A community event you're going to is coming up") to people
  going, and one if the event is cancelled.
- Suspended members can't say they're going.

API: `GET /v1/events`, `GET /v1/events/:id`, `POST /v1/events/:id/rsvp`, `DELETE /v1/events/:id/rsvp`.

## 3. Privacy and retention

- Stored: who said they're going and when. Deleted 30 days after the event ends, or with the account;
  in "Download my data". The count is the only thing other members see.
- Events themselves contain no personal data; ended events are deleted after a year.

## Tests

Integration: staff-only management with audit, validation (time window, capacity, curated place),
members see only upcoming scheduled events, RSVP is idempotent and respects capacity under
concurrency, no attendee identities in any member response, cancelling notifies attendees and blocks
new RSVPs, suspended members refused, export, reminder and retention job. Unit: schemas. E2E: an admin
publishes an event in the dashboard (English, Hebrew), a member says they're going, in four languages
with axe; screenshots.

## Results

| Check             | Result                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration tests | 7 new: admin-only management with audit, validation, counts without identities, capacity under concurrency (4 people, 2 places), cancel notifies, suspended refused, reminder, retention, export |
| Unit tests        | shared 36 (event schemas)                                                                                                                                                                        |
| E2E               | An admin publishes in the dashboard (English, Hebrew), a member says they're going, in **all four languages**; no names of people going on the page; axe-core **0** violations                   |
| Screenshots       | `docs/screenshots/<locale>/48–50`, `admin-09-events`, `showcase-events-<locale>.png`                                                                                                             |

## Bugs found and fixed

1. Link, number, date and time fields in the dashboard were unstyled; this also affected the existing
   donation-link field on the Branding page.
2. The e2e test first wrote event times in UTC; the app was right, the test data was wrong (now in the
   community's time zone).

## Known limitations

- ~~No waiting list~~: added in [phase 16](PHASE-16.md).
- Times are entered in the staff member's own time zone; a community spread across time zones
  would need a time zone per event.
