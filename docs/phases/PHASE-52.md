# Phase 52: Email the admins when backups stop (v1.25)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

Phase 51 shows the last backup on the dashboard's System page, but nobody opens it every day. A
backup that silently stops (phase 48 found exactly that) should reach the people who can fix it.

## What

A daily worker job (`backup-watch`, 09:41 server time):

- **Fresh** (a backup in the last `BACKUP_STALE_HOURS`, 36): nothing.
- **New server** (no backup yet, and the oldest account is under 48 hours old): nothing, so a new
  install isn't alarmed before its first nightly backup.
- **Otherwise**: every **active admin** gets one email (Hebrew and English), and the team's alert
  channel (phase 24, when set up) gets one line. The email says when the last backup finished (or
  that there never was one), what to check on the server (schedule, log, the command to run one
  now) and links to the System page.
- **Once a day at most**: the alert is recorded as a `backup-alert` run _before_ sending, so a run
  within 20 hours, or a mail server failing half-way, never turns into repeated emails. One
  address failing doesn't stop the others.
- It stops by itself as soon as a new backup is recorded.

Moderators and suspended admins aren't emailed. No member data is in the email: a time, paths and
a link. PRIVACY.md row added ⚖️.

## Tests

- Integration `backup-watch.test.ts` (5): fresh; new-server grace; never backed up (both active
  admins emailed, not the moderator or the suspended admin; alert line); an old backup named in
  the email, no repeat after 2 hours, a repeat after 21; one address failing, then a new backup
  stopping the emails.
- Unit `system-email.test.ts` (3): both languages and the links; the UTC time; the community name
  escaped in HTML and kept on one line in the subject.
- A real send through Mailpit: subject, text and HTML arrive intact.
