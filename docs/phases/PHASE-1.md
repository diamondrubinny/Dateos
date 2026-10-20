# Phase 1: Auth, profile, photos, mobile onboarding (+ sponsors, screenshots)

> Status: in progress. Builds on phase 0. 📘 = verify against official docs, ⚖️ = needs legal review.

## Scope

| #   | Deliverable        | Notes                                                                                                                                                                                                                                                                                             |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/db`      | Drizzle schema + SQL migrations + migrate script                                                                                                                                                                                                                                                  |
| 2   | Auth               | **better-auth** mounted at `/v1/auth/*`: email magic link (default, free), optional Google/Apple via env, Expo plugin for native session storage. Built-in rate limits on sign-in. Passkeys come in phase 1b                                                                                      |
| 3   | Profile API        | `/v1/me`, profile, preferences, prompts, consents, account deletion, public `/v1/instance`                                                                                                                                                                                                        |
| 4   | Photos             | Upload **through the API** (multipart, ≤10 MB, max 9) → magic-byte check → quarantine bucket → worker: ClamAV scan → `sharp` re-encode (auto-rotate, strip all EXIF/GPS, max 2048 px, WebP) → private media bucket → short-lived signed URLs                                                      |
| 5   | `apps/worker`      | BullMQ consumer for media jobs and storage cleanup on account deletion                                                                                                                                                                                                                            |
| 6   | `packages/storage` | S3 client helpers shared by API and worker                                                                                                                                                                                                                                                        |
| 7   | `apps/mobile`      | Expo Router app (iOS, Android, **web**): language picker, sign-in, check-email, onboarding (birth date, consents, basics, intentions, photos, prompts), home placeholder, profile, settings (language, delete account). Hebrew + English, full RTL, screen-reader labels, no gesture-only actions |
| 8   | Sponsors           | `.github/FUNDING.yml`, tier table in `docs/SPONSORS.md`, README section                                                                                                                                                                                                                           |
| 9   | Screenshots        | Real screenshots of the web build captured by Playwright against the running stack (real sign-in through Mailpit), in `docs/screenshots/`, English README showcase                                                                                                                                |

## Key decisions

- **Upload via API instead of presigned PUT:** lets the server enforce size and type before anything is stored. It costs a little API bandwidth, which is acceptable for single-server instances.
- **Age gate:** birth date is set once. If it shows the user is under 18, the account is suspended with reason `underage`, sessions are revoked, and the profile is not saved. ⚖️
- **Account deletion:** immediate hard delete of DB rows in one transaction, plus a background job that deletes stored photos. (The 14-day grace period from the plan moves to phase 6 as an opt-in.)
- **Malware scanning:** `MALWARE_SCAN=clamav|disabled`. `disabled` (Lite mode) logs a warning on every job. Re-encoding still neutralises most image payloads, but it is not a substitute for scanning.
- **Sponsor links on iOS/Android:** hidden in native builds. App Store and Play rules on donations/tips inside apps need checking 📘. They are shown on the web build only.

## Data added (see Data Map in PLAN.md)

| Data                    | Purpose              | Basis                          | Retention                                                             |
| ----------------------- | -------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Email                   | sign-in              | contract                       | until account deletion                                                |
| Birth date              | age gate, age filter | contract / legal obligation ⚖️ | account lifetime                                                      |
| Profile fields, prompts | matching             | contract                       | until edited/deleted                                                  |
| Photos                  | profile              | contract                       | deleted with the account (quarantine copies deleted after processing) |
| Consents                | proof of consent     | legal obligation               | account lifetime; versioned                                           |
| Audit log               | security             | legitimate interest            | 12 months, no PII in `meta`                                           |

## Tests

- Unit: schemas, age calculation, image-type sniffing.
- Integration (real Postgres/Redis/S3 when `INTEGRATION=1`): sign-in via magic link, profile CRUD, **IDOR** (user B cannot read/modify/delete A's photos), underage path, deletion removes everything.
- E2E: Playwright web flow that also captures the screenshots.
