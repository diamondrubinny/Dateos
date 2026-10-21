# Phase 4: Reports, moderation dashboard, photo verification

> Status: ✅ done (2026-10-21). Automated nudity detection is deferred. 📘 = verify against official docs, ⚖️ = needs legal review.

## Scope

| #   | Deliverable                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Report** any profile or chat: category, details, optional chat evidence. Reporting also blocks by default. Evidence is snapshotted, so it survives unmatch purges                                                                                                                           |
| 2   | **Priority triage**: underage and threats are urgent; scams and harassment are high; everything else is normal                                                                                                                                                                                |
| 3   | **Staff roles** (`moderator`, `admin`), granted only from the server CLI and never over HTTP                                                                                                                                                                                                  |
| 4   | **Mandatory MFA for staff**: TOTP (RFC 6238, implemented with Node crypto). The secret is encrypted with AES-256-GCM under a key derived from `AUTH_SECRET`. Each admin API call needs a session verified within the last 12 hours                                                            |
| 5   | **Moderation actions**: dismiss, warn, suspend (revokes sessions), ban (suspends and stops the email from re-registering via a salted hash), lift suspension. Each needs a reason and is written to the audit log                                                                             |
| 6   | **Photo verification with a human in the loop**: the user takes a selfie copying a random pose; a moderator compares it with the profile photos and approves or rejects. **No automated face recognition and no biometric templates.** The selfie is deleted as soon as a decision is made ⚖️ |
| 7   | **Verified badge** on profiles and cards                                                                                                                                                                                                                                                      |
| 8   | **Admin web app** (`apps/admin`, React + Vite, Hebrew/English, RTL): MFA setup and verification, report queue, report details with evidence, actions, verification queue, audit log                                                                                                           |
| 9   | App: report flow from profile and chat, verification flow, badge                                                                                                                                                                                                                              |

## Data model

| Table                | Purpose                                                                                                   | Retention                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `reports`            | reporter (set null on delete), reported (cascade), match, category, details, priority, status, resolution | 12 months after resolution ⚖️                  |
| `report_evidence`    | snapshot of selected chat messages (text only)                                                            | with the report                                |
| `moderation_actions` | target, staff, action, reason, created_at                                                                 | 24 months ⚖️                                   |
| `banned_emails`      | salted SHA-256 of a normalized email                                                                      | until lifted                                   |
| `staff_mfa`          | user, encrypted TOTP secret, enabled_at                                                                   | while staff                                    |
| `staff_sessions`     | session id, mfa_verified_at                                                                               | session lifetime                               |
| `verifications`      | user, pose, selfie photo, status, decided_by, decided_at                                                  | metadata 24 months; selfie deleted on decision |

## API

| Endpoint                                                                            | Who                                                                                                   |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /v1/reports`                                                                  | 🔐 user. The target must exist; chat evidence must come from the reporter's own match with the target |
| `GET /v1/me/verification`, `POST /v1/me/verification` (multipart selfie)            | 🔐 user                                                                                               |
| `POST /v1/admin/mfa/setup`, `POST /v1/admin/mfa/verify`                             | 🛡️ staff role                                                                                         |
| `GET /v1/admin/reports`, `GET /v1/admin/reports/:id`                                | 🛡️ staff + MFA                                                                                        |
| `POST /v1/admin/reports/:id/resolve` `{action, reason}`                             | 🛡️ staff + MFA (ban is admin-only)                                                                    |
| `GET /v1/admin/verifications`, `POST /v1/admin/verifications/:id` `{approve}`       | 🛡️ staff + MFA                                                                                        |
| `GET /v1/admin/verifications/:id/selfie`, `GET /v1/admin/users/:id/photos/:photoId` | 🛡️ staff + MFA, audited                                                                               |
| `GET /v1/admin/audit`                                                               | 🛡️ admin + MFA                                                                                        |

## Threat model additions

| Threat                            | Control                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Stolen staff session              | TOTP step-up per session (12 h), roles checked on every request, all staff reads of private data audited         |
| Privilege escalation              | Roles only via server CLI; `role` is `input: false` in auth; tests check that users get 403 on every admin route |
| Report abuse (mass false reports) | Rate limit per user, one open report per reporter/target pair, reports never auto-suspend                        |
| Evidence tampering                | Evidence copied server-side from the database, never from client input                                           |
| Banned user re-registering        | Salted email hash checked when an account is created                                                             |
| Admin UI XSS / clickjacking       | Separate app, React escaping, strict CSP, frame-ancestors none, no inline scripts                                |
| Selfie misuse                     | Visible only to staff with MFA, audited, deleted on decision, never used for automated matching                  |

## Tests

Unit tests for TOTP (RFC 6238 test vectors), encryption round-trip, and priority rules. Integration tests for reports (evidence scoping, auto-block, duplicates), admin authorization (no role → 403, role without MFA → 403, MFA → 200), every action including ban re-registration, and the verification flow including selfie deletion. E2E screenshots of the admin app and the report and verification flows, plus axe.

## Decisions made while building

- **Suspended members can still sign in**, but only to read their account state and delete the account (right to erasure). Every other route answers 403.
- **Suspension and ban also close all active chats** and settle the member's other open reports, so nobody keeps chatting with a suspended account.
- **Reports need prior contact** (visible now, matched at some point, or liked by them). Anything else answers 404, so reporting cannot be used to probe accounts.
- **Ban hashes are keyed** (HMAC with a key derived from `AUTH_SECRET`) and the email is normalised (case, `+tag`, Gmail dots). A leaked table cannot be matched against address lists.
- **Staff photo and selfie responses** are `no-store` and are fetched into object URLs by the dashboard. Every view is audited.
- **Operator guide** with CLI, 2FA, headers, decisions and retention: [`docs/ADMIN.md`](../ADMIN.md).

## Results

| Check                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                                   | api 37 (incl. RFC 6238 test vectors, AES-GCM tamper/wrong-key, email normalisation, CLI parsing), ai 31, shared 17, worker 9, mobile 6, admin 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Integration tests (real Postgres, Redis, S3) | **66 passed** (15 new): evidence copied only from the shared chat and kept after a purge, auto-block, duplicates/strangers/self, urgent staff email without content, 403 on every admin route for members, `MFA_REQUIRED` without TOTP, replay/expiry/second session/re-enrolment/lockout, role revocation is immediate, queue priority, audited reads, photo ownership check, warn/ack, suspend effects, moderator cannot ban, ban blocks variant addresses after deletion, lift ban, no lifting age suspensions, no actions on staff, verification lifecycle with selfie deletion, retries after a failed scan, daily limit, no self-review |
| Mutation tests                               | Removing the MFA check, the ban hook, the evidence scoping or the replay check each makes the suite fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Retention job                                | Run on the test DB: an old dismissed report and a stale unfinished verification deleted; recent and open ones kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Three-browser e2e (en + he)                  | Report from the chat → staff signs in by magic link → TOTP setup (wrong code refused) → queue → evidence + photos → suspend (en) / warn (he) → selfie approved → audit log. The member sees the suspension screen or the warning; the selfie row is gone afterwards; the dashboard sends `frame-ancestors 'none'`                                                                                                                                                                                                                                                                                                                             |
| axe-core WCAG 2.1 A/AA (30 new screens)      | 7 issues found (language button name did not contain its visible text) → fixed → **0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Bugs found and fixed during this phase

1. **Suspended accounts could not delete themselves.** All routes answered 403, which blocked the right to erasure. `GET /v1/me` and `DELETE /v1/me` now stay open, and the app shows a suspension screen.
2. **Path-prefix check in the dashboard's static server** accepted sibling folders (`dist-evil`). It now compares against `root + separator`.
3. **Raw "Too Many Requests"** was shown on the staff sign-in. It is now a translated message.
4. **Ambiguous Hebrew label**: "תיאור המדווח/ת" could mean the reported person. It is now "תיאור מגיש/ת הדיווח".

## Known limitations

- No automated nudity or abuse-image detection yet (chat images stay blurred until tapped).
- The verified badge stays when profile photos change; re-verification on photo changes is planned.
- A reported account that deletes itself takes its reports with it (only a ban hash remains) ⚖️.
- No in-app appeal flow; operators should publish a contact address.
- Native camera capture for selfies still needs on-device testing (the web uses a file picker).
