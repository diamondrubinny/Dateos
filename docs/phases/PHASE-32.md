# Phase 32: New-device sign-in alerts, search in a chat, dependency updates (v1.5)

> Status: ✅ done (2026-10-28), #39 after CI. 📘 = verify against official docs, ⚖️ = needs legal review.

## 32a. An email when a new device signs in

- When the account signs in on a **kind of device it hasn't used in the last 90 days** (the coarse
  code from phase 29, e.g. "Firefox · Linux"), and it isn't the account's first sign-in, the
  member gets a short bilingual email: "New sign-in to your account: Firefox · Linux, 28 Oct
  15:47. If it wasn't you, open Settings → Security and sign out everywhere else."
- **No link in the email** (like safety alerts): a real alert never asks you to click, so it
  can't be imitated for phishing. No IP address, no location.
- At most 3 such emails a day per account (Redis counter), so a flood of sign-ins can't flood the
  inbox.
- On by default; **Settings → Security → "Email me about new sign-ins"** turns it off
  (`preferences.signin_alerts`).

## 32b. Search in a chat

- A search field at the top of a chat finds my and their text messages containing the words
  (case-insensitive), newest first, at most 20, with the date.
- Never finds unsent messages, or messages hidden from me by the harm filter; only in a chat I'm
  part of (404 otherwise). Search terms are not logged.
- `GET /v1/matches/:id/messages/search?q=` (2–100 characters), per-user rate limit.

## 32c. Logs without query strings (found while building 32b)

- Request logs kept the whole URL, including the query string. That carried the one-time sign-in
  token of a magic link (`/magic-link/verify?token=…`), and would have carried chat searches.
  The request serializer now logs the path only (`logUrl`), with a unit test.

## 32d. Dependency updates

- Dependabot's grouped minor and patch updates (PR #39) are checked by the full CI and merged
  when green; anything that breaks is fixed here.

## Order of work

1. 32a + 32b: shared, db (migration 0041), API, integration tests.
2. App: alerts switch in Security; search in the chat; i18n ×4. e2e.
3. Docs; PR; CI; merge. Then #39.
