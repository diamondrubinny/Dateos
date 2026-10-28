# Phase 31: Account activity, mute and archive chats (v1.4)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

## 31a. Account activity (security transparency)

Members can see what happened to their account recently, so they notice a sign-in that wasn't
them.

- **Settings → Security → Account activity**: the last 90 days of security events on the account:
  - signed in (with the coarse device name from phase 29: "Chrome · Windows");
  - signed a device out, signed out everywhere else;
  - downloaded my data.
- Each item has a date and time; the newest first, at most 50.
- A sign-in is now audited (`session.created`, with the device code only: no IP address, no
  browser string). The audit log keeps its existing retention. These rows are **not** shown in
  the staff audit view (they're for the member), and they're deleted with the account.
- `GET /v1/me/activity`: only the member's own events, from a fixed allowlist of actions (never
  staff notes, never anything about other people).

## 31b. Mute and archive a chat

- **Mute:** no push notifications for new messages in that chat (calls and safety alerts are not
  muted). The chat still shows unread counts.
- **Archive:** the chat moves to an "Archived" section at the bottom of Matches. A new message
  from the other person brings it back.
- Both are private: the other person is never told.
- `PUT /v1/matches/:id/prefs` with `{ muted?, archived? }`; `GET /v1/conversations` returns them.
- Data: `match_prefs` (match, member, muted, archived), deleted with the match or the account; in
  "Download my data".

## Security checks

- Prefs: only a member of the active match (404 otherwise); a per-user rate limit.
- Activity: allowlisted actions only, `actor_id` = the member, 90 days.

## Order of work

1. Shared, db, migration, API, worker (skip muted pushes); integration tests.
2. App: activity list in Security; mute/archive in the chat's menu and the Matches list; i18n ×4.
3. e2e `pnpm --dir e2e activity-archive`, docs, PR, CI, merge.
