# Phase 45: Running late: extending a safety check-in (v1.18)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

A safety check-in (phase 9) emails the trusted contact if the member doesn't tap "I'm OK" in time.
A date that goes well often runs long, and until now the only options were to cancel the
check-in (losing the protection) or let the contact be emailed for nothing.

## What

- **"Running late?"** on the active check-in: **30 more minutes**, **1 more hour**,
  **2 more hours**. The new time counts from the current check-in time, or from now if that
  already passed (the member got the reminder and is within the 15-minute grace).
- At most **3** extensions (`CHECKIN_EXTENSIONS`), and never past **12 hours** from the start
  (`CHECKIN_MAX_HOURS`, the same limit as creating). The screen says when no more are left.
- The reminder comes again at the new time. Nothing is sent to the contact.
- Once the contact has been emailed, extending is refused (409): the member can only say "I'm OK".
- Works for a suspended account too, like the rest of the check-in (safety first).
- Fix on the same screen: the masked contact address is wrapped in Unicode isolates (`ltr()`), so
  the parentheses and full stop stay in place in Hebrew and Arabic.

## API

`POST /v1/me/checkins/:id/extend` `{ minutes: 30 | 60 | 120 }` → the check-in (owner-only, 20/hour).
`checkins.extensions` counts them (migration `0049`); the check-in now returns `extensionsLeft`.

**Race with the worker.** The alert job locks a due row, emails, and marks it `alerted` in one
transaction. Extending is one `UPDATE … WHERE status = 'active' AND check_at > now() − grace`:
if the worker holds the row, the update waits, re-checks the row after the commit, and finds it
alerted, so the contact never gets an email for a check-in the member had just moved.

## Privacy

Only a counter is added. It's part of the check-in, deleted with it (7 days after it ends), and
included in "Download my data". PRIVACY.md row updated ⚖️.

## Tests

- Integration `checkin-extend.test.ts` (6 tests): moves from the current time; after the reminder
  counts from now, re-arms the reminder and doesn't alert; the limit; the 12-hour cap; refused after
  the alert; owner-only and only the offered lengths.
- e2e `pnpm --dir e2e checkin-late` (en, he): one hour later in the database, the isolated address,
  the "no more" state, then "I'm OK"; axe 0. `pnpm --dir e2e checkin` re-run (4 languages).
