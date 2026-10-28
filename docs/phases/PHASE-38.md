# Phase 38: Pinned chats, message drafts (v1.11)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

## 38a. Pinned chats

- In a chat's menu (next to Mute and Archive, phase 31): **Pin to top** / **Unpin**. Up to **3**
  pinned chats; a 4th asks to unpin one first (409).
- Pinned chats come first in Matches (most recently pinned first), marked "📌 Pinned" in words for
  screen readers, not only by the icon.
- Pinning an archived chat brings it back; archiving a chat unpins it. Private: the other person is
  never told.
- Data: `match_prefs.pinned_at` (migration `0045_pinned_chats.sql`); `PUT /v1/matches/:id/prefs`
  takes `pinned`. Deleted with the match or the account, like the other chat choices.

## 38b. Message drafts

- What you typed and didn't send stays in that chat's box when you come back, and Matches shows
  "Draft: …" for that chat.
- **On this device only**: drafts are never sent to the server. They're cleared when sent, when
  emptied, and all of them on sign-out (a shared device doesn't keep them).
- Up to 1,000 characters are kept (the device keychain may refuse much more 📘); drafts older than
  30 days are dropped. Listed in the cookie policy and the in-app storage list.

## Order of work

1. db, shared, API (pinned, limit, sort); integration tests.
2. App: Pin in the chat menu, pinned first in Matches, drafts; i18n ×4. e2e
   `pnpm --dir e2e pins-drafts`.
3. Docs, PR, CI, merge.
