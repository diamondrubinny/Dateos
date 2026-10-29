# Phase 51: System page in the dashboard, with the last backup (v1.24)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

Phase 48 found that daily backups had been failing silently on installed servers: nothing in the
product showed it. Operators should see it without logging in to the server.

## What

- **Dashboard → System** (admins only, after two-factor authentication):
  - **Backups**: when the last backup finished and its size. No backup recorded, or the last one over
    `BACKUP_STALE_HOURS` (36) old, is an alert (`role="alert"`, in words, not only colour) with
    what to check on the server: the schedule, the log, and the command to run one now (shown
    left-to-right in code, so they read correctly in Hebrew).
  - **Parts of the server**: the same checks as `/ready` (database, Redis, storage, the queues,
    live updates, email), each named in plain words and marked "Working" or "Not working".
- `scripts/backup.sh` records each successful run in `maintenance_runs` (kind, time, total bytes).
  If that insert fails (a database from before this phase) the backup still succeeds and says so.

## API

`GET /v1/admin/system` → `{ status, checks, backup: { lastAt, bytes, stale } }`. Staff
authentication and MFA as every admin route, then admins only (403 for moderators). `no-store`.
Migration `0051` (`maintenance_runs`, no personal data).

## Tests

- Integration `system-status.test.ts` (3): same checks as `/ready`; never/recent/old backups and
  that only the latest `backup` row counts; moderators 403, members 403, signed out 401.
- A real `scripts/backup.sh` run against the local stack inserted its row.
- e2e `admin-a11y` now includes the System page (dark and light, en and he): the alert when no backup
  is recorded, and the calm state after one; axe 0. Screenshot `126-admin-system-no-backup`.
