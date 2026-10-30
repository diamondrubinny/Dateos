# Phase 54: Update emails to the admins (v1.27)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.

## Goal

Phase 53 shows an available update in the dashboard, but only to an admin who opens it. Communities
run by volunteers may not open it for weeks. Now the admins are **emailed**:

1. **A new version is available**: what was added or fixed (the first 10 changes, with the count of
   the rest), and a link to System → Updates to approve it. Nothing installs from the email.
2. **The update finished**: installed, or didn't, and why (the updater's own message), with the
   same link.

## Rules

| Email            | Sent when                                                                                                                        | At most                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Update available | after the 6-hourly check: the server is behind, the latest commit wasn't announced yet, no update is already approved or running | once per 20 hours (a busy `main` gives one email a day, not one per merge) |
| Update result    | a request reaches `done` or `failed` (a withdrawn one isn't mailed)                                                              | once per request                                                           |

- To every **active admin** (as the backup alert, phase 52), in Hebrew and English in one email.
- Recorded before sending: a mail server failing half-way never turns into an email every run.
- Results finished before this phase (existing rows) are marked as already told by the migration.
- `UPDATE_EMAILS=off` in `.env` turns both off; the dashboard still shows everything. The dashboard
  says whether admins are emailed.

## Data

Migration `0053_update_emails`:

- `update_status.notified_commit`, `update_status.notified_at`: the last commit announced, and when.
- `update_requests.notified_at`: when the result was mailed (set for old finished rows).

## Security and privacy ⚖️

- Links in the email: the dashboard's own address (`PUBLIC_ADMIN_URL`) and the pull requests on the
  configured `UPDATE_REPO` only. Change titles are plain text, escaped in HTML, one line each.
- No member data. The admins' addresses go only to the community's own mail server (SMTP).
- Approving still needs the dashboard (MFA, recent sign-in); the email has no action link.

## Tested for real

- Integration (7): the email goes to every active admin, once per version; a newer version waits
  out the 20 hours; nothing when up to date, the version is unknown or another, or an update is
  already approved or running; one failing address doesn't block the others or repeat; results
  (installed, failed) mailed once each, a withdrawn one and an open one never. Unit (4 + 2): the
  emails' text, links, escaping and count; the dashboard address.
- The real worker against Mailpit: a failed update and an installed one, each mailed once to every
  active admin within 2 minutes, and marked as told.
- `pnpm --dir e2e admin-updates` (en, he): the dashboard says admins are emailed; axe 0.
- Screenshots: `he/129-email-update-available.png`, `he/130-email-update-installed.png`.

### Found and fixed on the way

- **Emails linked to `/#/system` with no address** (also the phase 52 backup alert and the daily
  summary): `PUBLIC_ADMIN_URL` is empty after the install command and the worker didn't fill it in
  as the API does. Now: `PUBLIC_ADMIN_URL`, else `admin.` + the app's address (`PUBLIC_APP_URL` or the
  first CORS origin, which install.sh sets to `https://DOMAIN`).
- Hebrew: a number after a Latin community name ("NexaHeart: 3") jumped sides; the sentence was
  rephrased and the name is isolated (`<bdi>`) in all three admin emails.
- System → Updates: the heading touched the button above it; "ב־GitHub" had a maqaf before Latin.

## Order of work

1. Migration; worker env `UPDATE_EMAILS`; API env + status view `emails`.
2. Shared: `updateAvailableEmail`, `updateResultEmail` (he + en, text + HTML); unit tests.
3. Worker: `processUpdateNotice` after `update-check`; `update-results` job every 2 minutes.
4. Integration tests (when to send, once only, approved/running skips, results, old rows, off).
5. Dashboard: a line in Updates ("Admins are emailed…"), en + he; e2e re-run with screenshots.
6. Docs (INSTALL en/he, SELF_HOSTING, PRIVACY, CHANGELOG), PR, merge.
