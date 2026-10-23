# Phase 27: Event updates and questions to the organizers (v1.1)

> Status: ✅ done (2026-10-23). Chosen instead of an attendees' group chat, which would break
> phase 14's rule: **who else is going is never shown; members meet at the event, not before** ⚖️.
> 📘 = verify against official docs, ⚖️ = needs legal review.

Events need a way to talk: "we moved inside because of the rain", "running 15 minutes late", "is
there parking?". This phase adds it without telling anyone who else is going.

## 27a. Updates from the organizers

- Admins post short updates to an event (up to 500 characters) in the dashboard, and can delete one.
- **Who sees them:** members going or on the waiting list, on the event page under "Updates from the
  organizers", newest first. Others see nothing (not even that there are updates).
- Everyone going or waiting gets a **content-free push** ("A community event you're going to has an
  update"), the same kind as the reminder.
- Allowed until the end of the event; not on a cancelled event (the cancellation already tells
  everyone).

## 27b. Questions to the organizers

- A member going or waiting can ask the organizers a question (up to 500 characters, at most 5 open
  per event). It goes through the same harm filter as messages.
- **Admins see the question without the asker's name or id** (data minimisation: answering doesn't
  need it). They answer in the dashboard; only the asker sees the answer, with a content-free push.
  If many ask the same thing, the organizers can post an update.
- The asker can delete their question.

## API

| Method | Path                                                | Who                                                      |
| ------ | --------------------------------------------------- | -------------------------------------------------------- |
| GET    | `/v1/events/:id/board`                              | member going or waiting: updates and their own questions |
| POST   | `/v1/events/:id/questions`                          | member going or waiting                                  |
| DELETE | `/v1/events/:id/questions/:questionId`              | the asker                                                |
| GET    | `/v1/admin/events/:id/board`                        | staff (questions without who asked)                      |
| POST   | `/v1/admin/events/:id/updates`                      | admin                                                    |
| DELETE | `/v1/admin/events/:id/updates/:updateId`            | admin                                                    |
| POST   | `/v1/admin/events/:id/questions/:questionId/answer` | admin                                                    |

## Data (new)

- `event_updates` (event, author, text, time) and `event_questions` (event, asker, text, answer,
  who answered, times). Deleted with the RSVPs, `RSVP_RETENTION_DAYS` (30) after the event ends, or
  with the event; questions also with the account. In "Download my data" (own questions).
- Audit: `event.update_posted`, `event.update_deleted`, `event.question_answered` (ids only, never
  the text).

## Security and privacy

- Every member endpoint checks the RSVP on the server; ids from another event are 404.
- No endpoint returns who asked or who is going; staff responses carry no user ids.
- Question text never reaches logs or webhooks.

## Order of work

1. shared schemas, db tables and migration.
2. API (member and staff), retention, export; integration tests.
3. Mobile event page; dashboard panel; i18n in 4 languages (dashboard in English and Hebrew).
4. e2e `pnpm --dir e2e event-board`, docs, PR, CI, merge.

## Results

- **Built:** two tables (`event_updates`, `event_questions`, migration `0031_event_board`), member and
  staff endpoints, retention with the RSVPs, export, the board on the event page (4 languages) and
  an "Updates and questions" panel in the dashboard (English and Hebrew; moderators read only).
- **Tests:**
  - Integration: 5 new (updates only for people going or waiting, pushes to exactly them, no author
    or ids in responses; admin-only writes until the event ends, audit without text; private
    questions, staff never see who asked, only the asker sees the answer; attendance check, harm
    filter, 5 open questions, delete own only; retention and export).
  - e2e `pnpm --dir e2e event-board`: an admin posts and answers in the dashboard (English, Hebrew)
    or the API (Arabic, Russian); the member sees the update, asks, and reads the answer; someone not
    going gets nothing; all 4 languages; axe 0 violations. Screenshots `101-event-board` and
    `admin-17-event-board`.
- **Design note:** an attendees' group chat was considered and not built: it would show who else is
  going, against phase 14's rule. Updates and private questions cover the logistics without that.
- **Still to check:** ⚖️ keeping who answered a question (staff accountability) for 30 days.
