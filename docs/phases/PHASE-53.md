# Phase 53: Updates from GitHub, approved in the dashboard (v1.26)

> Status: 🚧 in progress (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Goal

When this repository's `main` moves on, every community running NexaHeart sees it in its
dashboard: **an update is available, what was added or fixed**, and a button to **approve
installing it**. Approving installs it on that server, with a backup first and a way back if the new
version doesn't start.

## Design: the dashboard approves, the server installs

The API that serves members must **not** be able to run commands on the server: giving it the Docker
socket would make any API bug a root compromise of the server. So the work is split:

| Part         | Where                                                                                     | Does                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Version      | baked into the API and worker images at build (`GIT_COMMIT`)                              | each server knows which commit it runs                                                           |
| Update check | worker, every 6 hours (and "Check now" in the dashboard)                                  | asks GitHub what's new since that commit                                                         |
| Approval     | dashboard → System → Updates (admin, MFA, recent sign-in)                                 | records "install commit X", nothing else                                                         |
| Install      | `scripts/update.sh` on the server, every minute from cron (set up by the install command) | sees the approval, backs up, updates, checks `/ready`, rolls back on failure, records the result |

### What's new: from GitHub, as plain text

`GET https://api.github.com/repos/{UPDATE_REPO}/compare/{current}...{UPDATE_BRANCH}` (unauthenticated,
60 requests/hour per server, one every 6 hours is plenty 📘). Every change on `main` is a merged pull
request whose merge commit carries the PR title ("Phase 52: email the admins when backups stop"), so
the list shows the PR titles, numbers and dates. Shown as text, never as HTML.

### Install, safely

`scripts/update.sh` (run by root's cron; also runnable by hand):

1. One at a time (`flock`). Reads the oldest approved request from the database.
2. The commit must look like a commit (40 hex characters) **and** be part of `origin/main`: nothing
   else from the database ever reaches a shell command or git.
3. Runs `scripts/backup.sh`. If the backup fails, nothing is changed.
4. Fast-forwards the code to that commit (never discards local changes), rebuilds and restarts with
   `GIT_COMMIT` set.
5. Waits for `/ready` (up to 15 minutes). If it doesn't come up: back to the previous commit,
   rebuild, and the request is marked failed with the reason. The backup from step 3 stays.
6. Records running / done / failed with a short message; the dashboard shows it live.

Database migrations only move forward. A rollback after a failed start runs the previous code on the
new schema; our migrations add tables and columns, so that works, but it's why step 3 always backs up
first.

### Privacy and control ⚖️

- The check sends one request to GitHub every 6 hours from the server (GitHub sees the server's
  address, nothing else). `UPDATE_CHECK=off` turns it off; manual updates still work.
- Updates are never installed without an admin's approval.
- Approving needs an admin with two-factor authentication who signed in within 15 minutes (as for
  deleting an account), and is recorded in the audit log.
- The source is fixed in the server's `.env` (`UPDATE_REPO`, `UPDATE_BRANCH`), never taken from a
  request.

## Order of work

1. Version in the images; `UPDATE_*` settings.
2. Database: `update_status` (the latest check), `update_requests` (approvals and results).
3. Shared schema; the GitHub check (integrations package, unit tests for parsing).
4. Worker job (6-hourly); API: status, check now, approve (tests).
5. Dashboard: banner on every page for admins, Updates section on System (en, he).
6. `scripts/update.sh` + cron from the install command; CI (shellcheck, dry run).
7. A real run in the sandbox: install an older commit, approve, let the script update it.
8. Docs (INSTALL en/he, SELF_HOSTING, PRIVACY), PR, merge.
