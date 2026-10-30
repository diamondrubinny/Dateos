# Phase 56: Choose when an update installs, and the update history (v1.29)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

Approving an update (phase 53) installs it within a minute, and the site is unavailable for a minute
or two while it restarts (phase 55 made that gentle, not invisible). An admin approving at 21:00, when
the community is busiest, interrupts dates and calls. And once an update is done, the dashboard only
shows the latest one: there's no record of what was installed when, or what failed.

## What changes

1. **When to install**, in the approval box: **Now** (as before) or **At a time I choose**: date and
   time in the admin's own time zone, prefilled with the coming 03:00, up to 7 days ahead.
   - The server's updater (`scripts/update.sh`) skips an approval until its time.
   - Until then it can still be withdrawn, and the dashboard says when it will install ("Approved: it
     will install on Sat 31 Oct, 03:00").
   - The "update available" email (phase 54) still isn't sent while one is waiting; the result email
     comes after it runs.
   - The "the server hasn't picked it up" warning counts from the chosen time, not from the approval.
2. **Update history** in System → Updates: the last 10 finished approvals: when, from which version to
   which, and the result (installed, didn't install with the server's message, withdrawn).

## Rules

- `at` must be in the future (a minute of clock difference allowed) and at most 7 days ahead;
  otherwise 400. Absent = now.
- Still only the latest known version, one open approval at a time, MFA + recent sign-in, audit log
  (`update.approve` records the chosen time).

## Data

Migration `0054_update_schedule`: `update_requests.not_before` (timestamptz, null = as soon as
possible).

## Security and privacy

- No new data about people; the history is the existing `update_requests` rows (already in the audit
  log too). The approving admin isn't shown in the history (the audit log has it, for admins).
- The time reaches `update.sh` only as a comparison inside SQL (`not_before <= now()`), never as text
  in a shell command.

## Accessibility

- The choice is a radio group with a legend; the date/time field has a label and a hint with the time
  zone; an invalid time is an inline error tied to the field (`aria-describedby`).
- The history is a table with a caption and column headers; results in words, not colour alone.

## Tested for real

- Integration (2 new, 10 in the file): a past time and one 8 days ahead refused (400, with the
  reason), a time with an offset kept as the same moment, the audit records it; the updater's
  query picks nothing until the time, then the approval. History: finished only, newest first, at
  most 10, without the latest one shown above it; an open approval is never history.
- `scripts/update.sh` against the database (`UPDATE_DRY_RUN=1`): scheduled for later → "Nothing to
  do yet"; its time came → would install; no time → as before. shellcheck clean.
- e2e `pnpm --dir e2e admin-updates` (en, he): the time starts at the coming 03:00; a past time is
  refused in place (`aria-invalid`, tied to the field); the chosen time is recorded; the waiting
  message says when, and it can be withdrawn; the history table (caption, headers, results in words).
  axe 0. Screenshots `134-admin-update-schedule`, `135-admin-update-scheduled`,
  `136-admin-update-history` (en, he).

Found on the way: the server's English message in a failed update's alert showed its full stop on
the wrong side in Hebrew (since phase 53); it now has its own direction (`dir="auto"`, `<bdi>` in the
history).

## Order of work

1. Migration; shared schemas (`installUpdateSchema.at`, `notBefore`, `history`); API (validation,
   audit); integration tests.
2. `update.sh`: skip until `not_before`; dry run says so; checked against the database.
3. Dashboard: Now / At a time I choose; the waiting message with the time; history table; en + he.
4. e2e `admin-updates` extended (schedule, withdraw, history); axe 0; screenshots.
5. Docs (INSTALL en/he, SELF_HOSTING, CHANGELOG), PR, merge.
