# Phase 6: Privacy and compliance

> Status: ✅ done (2026-10-21). 📘 = verify against official docs, ⚖️ = needs legal review. Nothing here is
> legal advice or a claim of compliance: it gives operators the technical means and draft texts to review.

## Scope

| #   | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Download my data** (access + portability): a ZIP with `data.json` (account, profile, preferences, prompts, consent history, photos metadata, interactions you made, matches, messages you sent, blocks, reports you filed, warnings you received, verification status, push devices, settings) plus your photos and voice messages. Messages from other people are not included (they are their data) ⚖️ |
| 2   | **Cookies and storage, honestly**: an inventory of every cookie and browser storage key. The app uses only strictly necessary ones (session, chosen language), so **no tracking and no banner**; a permanent "Privacy & cookies" page lists them. If an operator adds analytics, the existing `analytics` consent gates it                                                                                 |
| 3   | **Retention**: audit logs (24 months), auth leftovers (expired sessions/verification tokens, rate-limit rows), and an optional, off-by-default deletion of long-inactive accounts with an email warning first ⚖️                                                                                                                                                                                           |
| 4   | **`docs/PRIVACY.md`**: data inventory, legal basis per purpose, processors, retention schedule, data-subject request handling, breach response, DPIA screening, Israeli Amendment 13 and GDPR notes                                                                                                                                                                                                        |
| 5   | **Draft legal texts** (`docs/legal/`, English and Hebrew): privacy policy, terms of use, cookie policy, accessibility statement, each with operator placeholders and review markers                                                                                                                                                                                                                        |
| 6   | App: "Download my data" in Settings (and on the suspension screen), "Privacy & cookies" page linked from the welcome screen and Settings                                                                                                                                                                                                                                                                   |

## API

| Endpoint                                    | Notes                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /v1/me/export`                         | 🔐 the member only (also while suspended); 3 per day; audited; `application/zip`          |
| `PUT /v1/me/consents` `{kind: 'sensitive'}` | New required consent; withdrawing it pauses the account (hidden from discovery both ways) |
| `POST /v1/me/profile`                       | Now **403 until the required consents exist** (nothing sensitive is stored before)        |

## Found while building, and fixed

1. **Sexual orientation without explicit consent.** Gender plus "interested in" reveals orientation, a
   special category (GDPR Art. 9) and sensitive information under Israeli law ⚖️. Accepting the privacy
   policy is not explicit consent (see the Norwegian DPA's Grindr decision, 2021 📘). Now there is a
   separate, unticked, required `sensitive` consent with a plain explanation.
2. **Profile stored before consent.** Onboarding asked for the profile first and the consents second, so
   sensitive data was saved before any consent. The order is now consents → profile, and the server
   enforces it (`POST /v1/me/profile` returns 403 without consent, changing gender or interests too).
3. **Withdrawal had no effect.** Withdrawing the new consent in Settings sets the account to `paused`:
   hidden from everyone's discovery, sees no one, sent back to the consent step. Consenting again
   restores it, and never lifts a suspension.
4. **Sessions stored IP addresses and browser strings** (better-auth default) that nothing used. They are
   no longer stored; the daily job erases them from older sessions.
5. **Logs without limits.** docker-compose now rotates api/worker/web logs (about 50 MB per service),
   because they contain IP addresses. The worker also gets the SMTP host for inactivity emails.
6. **Inactivity measured from sessions** would have been wrong once expired sessions are deleted. A
   `last_seen_at` column (updated on sign-in and on the daily session refresh) is used instead.
7. **Members from before the new consent** would have stayed visible without it. Migration `0011` pauses
   them; the app asks for the consent on their next visit, and giving it reactivates the profile.
8. **The README still listed voice and push as "next"** although phase 3b shipped them.

## Retention jobs (daily, worker)

| Job                          | Rule                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Audit log                    | delete after 24 months                                                                                                               |
| Sessions, sign-in tokens     | delete when expired; erase IP/user agent left from older versions                                                                    |
| Rate-limit rows              | delete after 1 day                                                                                                                   |
| Inactive accounts (off: `0`) | `INACTIVE_ACCOUNT_DELETE_MONTHS`: email (no links) → 30 days → delete account and files; signing in cancels it; staff never included |
| Already present (phases 2–4) | impressions/picks 30 days, closed chats 30 days, resolved reports 12 months, moderation log and verification records 24 months       |

## Tests

| Check                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration tests      | **94 passed** (10 new): export contents and exclusions (others' messages, staff notes, hashes, secrets), suspended export, limit and audit; retention (audit log, expired sessions/tokens, rate-limit rows, legacy IP scrub, sessions store no IP/UA); inactivity off by default, warning → deletion with files and audit, staff excluded, sign-in cancels; no profile before consent, withdrawal hides both ways, re-consent restores, suspension kept |
| Mutation tests         | Removing the staff filter, the sign-in reset of the warning, the consent check on profile creation, the paused-viewer filter, or the session minimisation hook each makes the suite fail                                                                                                                                                                                                                                                                |
| Unit tests             | api 37, ai 45, shared 22, worker 14, mobile 6, admin 3                                                                                                                                                                                                                                                                                                                                                                                                  |
| E2E privacy (en + he)  | Real sign-in through the UI, "Download my data" opens a valid ZIP with the account and the photo, the browser's cookies and storage match the published inventory (one HttpOnly cookie, one storage key, nothing in sessionStorage), **no request to any other host** (verified that the check fails when a host is not allowed)                                                                                                                        |
| E2E regression         | Onboarding in the new order (screenshots), chat, safety (incl. the suspension screen with the new button), voice: all pass                                                                                                                                                                                                                                                                                                                              |
| axe-core WCAG 2.1 A/AA | **0** on all screens, including the 4 new ones                                                                                                                                                                                                                                                                                                                                                                                                          |

## Known limitations

- Native "Download my data" uses the system share sheet (expo-file-system + expo-sharing); it is
  type-checked but needs testing on real iOS and Android devices 📘. The cached copy is removed at the
  next export (the OS may also purge it).
- Banned-email hashes have no automatic expiry: operators should review bans periodically ⚖️.
- Consent records are deleted with the account; whether proof of consent must be kept afterwards is a
  legal question ⚖️.
- The legal drafts describe the software's behaviour; they are not legal advice and need review.
