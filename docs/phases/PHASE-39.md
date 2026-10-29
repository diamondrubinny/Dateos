# Phase 39: Quiet hours (v1.12)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

Phase 33 let members choose which notifications they get. Many people want them, just not at
night.

## Quiet hours

- **Settings → Notifications → Quiet hours** (off by default). Turning it on suggests **23:00–08:00**;
  the start and end move in half hours ("Earlier" / "Later", each a labelled button for screen
  readers). The window may cross midnight.
- Times are in **this device's time zone** (the IANA name the device reports, e.g.
  `Asia/Jerusalem`), shown under the times; changing them again saves the current zone.
- During quiet hours the worker skips match, message, partner-message, event and profile pushes
  (result `quiet`). **Calls and safety check-in alerts always come through.** Nothing is lost:
  messages wait in the app; skipped pushes are not sent later in a burst.
- The local time is computed in Postgres (`now() AT TIME ZONE …`). A zone the device knows but the
  database doesn't makes the check fail open (notifications are sent), never a lost alert.
- Data: `preferences.quiet_start`, `quiet_end` (minutes after midnight), `quiet_time_zone`
  (migration `0046_quiet_hours.sql`). `GET/PUT /v1/me/settings` carry `quietHours` (null = off);
  start ≠ end and a real time zone are required (400 otherwise).
- Privacy: the time zone is a coarse hint of where someone lives; it's used only for this, never
  shown to anyone, and deleted with the account. Listed in PRIVACY.md ⚖️.

## Order of work

1. db, shared, API, worker; integration tests (inside/outside the window, calls and check-ins,
   validation).
2. App: the Quiet hours card in Settings; i18n ×4. e2e `pnpm --dir e2e quiet-hours`.
3. Docs, PR, CI, merge.
