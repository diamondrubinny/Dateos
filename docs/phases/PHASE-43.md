# Phase 43: Recent sign-in for sensitive actions, photo descriptions to partners (v1.16)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## 43a. Sign in again before the irreversible

Sessions last 30 days. Anyone holding an unlocked phone, or a stolen session cookie, could delete
the account or move it to another mailbox (phase 41).

- **Deleting the account** and **asking to change the email** now need a session that signed in
  within the last **15 minutes**. Otherwise: 403 `REAUTH_REQUIRED`, and nothing happens.
- The app explains it ("For your safety…") and offers **Email me a sign-in link** to the account's
  own address. Opening the link signs in again on that device; then the action works. A community
  that requires the bot check (phase 24) sends the member to the usual sign-in screen instead.
- Everyday actions are unaffected. Confirming an email change (the link opened in the same account)
  doesn't need it again: the request already did.
- `requireRecentSignIn()` (API) reads the session's sign-in time from better-auth's session record;
  `RECENT_SIGN_IN_MINUTES` in shared.

## 43b. Photo descriptions reach partner communities

Phase 40 left them out of the partner card. The card's photo entries now carry the optional
`description` (≤ 150). Older partners drop it (unknown fields are stripped), and cards from them
simply have none, so both directions stay compatible.

## Order of work

1. API: session sign-in time, the check on the two routes, error code; federation card field;
   integration tests (old/fresh/within-window sessions; a description crossing communities).
2. App: `ReauthNotice` on delete-account and change-email; i18n ×4. e2e `pnpm --dir e2e reauth`
   (real mail); change-email and privacy e2e re-run.
3. Docs, PR, CI, merge.
