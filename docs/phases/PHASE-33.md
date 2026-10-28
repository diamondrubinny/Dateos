# Phase 33: Notifications your way, "Maybe later" (v1.6)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

## 33a. Choose which notifications you get

- **Settings → Notifications**: three switches, all on by default:
  - new matches;
  - new messages (in all chats; a single chat can still be muted, phase 31);
  - community events (reminders and updates from the organizers).
- **Always on, by design:** incoming calls (turned off with "Accept calls", phase 15) and safety
  check-in alerts (phase 9), so a safety feature can never be silenced by accident.
- Partner-community messages follow "new messages".
- Data: `preferences.notify_matches`, `notify_messages`, `notify_events`. The worker checks them
  before sending; skipped pushes return `off`.

## 33b. "Maybe later"

- In Discover, besides Pass and Like: **Maybe later** puts a profile aside without deciding. It
  leaves the deck and waits in **Likes → Maybe later** (up to 30), newest first.
- From there: like, pass or remove it. Liking or passing anywhere clears it.
- Private: the other person is never told. A saved profile that can no longer be shown (blocked,
  paused, deleted, no longer matching your preferences) simply disappears from the list.
- `POST /v1/saved` `{ targetId }`, `DELETE /v1/saved/:id`, `GET /v1/saved`. Only a profile you
  may see now can be saved (404 otherwise). Rate-limited per user.
- Data: `saved_profiles` (member, target, time), deleted with either account; in "Download my
  data".

## Order of work

1. db (migration 0042), shared, API, worker; integration tests.
2. App: switches in Settings, "Maybe later" in the decision panel and the Likes tab; i18n ×4.
3. e2e `pnpm --dir e2e later-notify`; docs; PR; CI; merge.
