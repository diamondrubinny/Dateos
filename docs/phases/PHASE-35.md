# Phase 35: Blocked people, profile strength (v1.8)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

## 35a. Blocked people

Blocking has existed since phase 3 (`POST /v1/blocks`), but a member couldn't see whom they
blocked or take it back.

- **Settings → Security → Blocked people**: name and date, newest first (up to 200), with **Unblock**
  (asks to confirm).
- Unblocking does **not** bring back the match or the chat: a block always closed the match, and
  it stays closed (and, as after any unmatch, the two aren't shown to each other again). Someone
  never matched can appear in decks again, as before the block.
- The blocked person is never told, either way.
- `GET /v1/blocks` (only my own), `DELETE /v1/blocks/:userId` (404 if I hadn't blocked them).
  Rate-limited per user. Audited (`block.removed`).
- The list shows the name only: no photos, so a block list can't be used to keep looking at
  someone. A deleted account disappears from it.

## 35b. Profile strength

- **Profile tab**: "Profile strength", a short checklist computed in the app from `/v1/me` (no new
  data, nothing sent anywhere):
  - at least 3 photos; a bio; at least 2 prompt answers; interests; photo verification; a voice
    prompt (optional, phase 19).
- Each missing item links to where it's done. Text, not only a bar (count "4 of 6" plus a list
  with ✓ / ○, not colour alone). Hidden once everything is done.

## 35c. Fixes (found by re-running every older e2e suite)

- Focus mode counted 0 people waiting once anyone had unmatched (`notSeparated` alias shadowing):
  fixed in phase 34's PR, regression test.
- **Double dates could miss pairs** once more than 300 people were nearby: pair discovery took an
  open candidate query, which stops at its row limit in no particular order. It now looks at the
  newest undecided pairs and checks exactly those four people (both ways, every rule).
- e2e: the sign-in helper ignored the "how to join" and waitlist-approval emails (it now skips only
  the new-device alert); the safety e2e opens its own report, not the first in a queue that now
  also holds automatic reports.

## Order of work

1. API: list and unblock; integration tests.
2. App: Blocked people screen; Profile strength card; i18n ×4. e2e `pnpm --dir e2e blocks`.
3. Docs, PR, CI, merge.
