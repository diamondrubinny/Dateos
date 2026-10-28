# Phase 36: Safety overview, a gentle start for new accounts (v1.9)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

## 36a. Safety overview (dashboard)

The moderation team sees reports one by one; nothing shows whether the queue is growing, which
automatic checks (phase 34) fire, or how long members wait for an answer.

- **Dashboard → Overview** (moderators and admins), counts only, no names, no ids:
  - open reports by priority and by category; the oldest open one's age;
  - the last 7 days: reports received (by members / automatic), automatic reports by reason,
    reports resolved and the median time to resolve;
  - photo verifications waiting;
  - the last 7 days: new accounts, suspensions.
- `GET /v1/admin/overview`, staff only (same MFA rules as the rest of the dashboard). Computed on
  request from existing tables; nothing new is stored.
- The page is the first in the nav after Reports; numbers in a table with headings (screen
  readers), not only charts.

## 36b. A gentle start for new accounts

Spam bots open many chats right after signing up. Phase 34 reports them after the fact; this slows
them down before:

- An account **less than 24 hours old** can start (send the first message in) at most **10
  conversations** in 24 hours. The 11th asks to slow down (429 `SLOW_DOWN`), with a calm message in
  the chat: "New accounts can start 10 conversations a day. Replies in your chats aren't limited."
- Replying in a chat the other person started, and further messages in a chat already started, are
  never limited.
- Computed from `messages` and `user.created_at` (DB clock); nothing new is stored.

## Order of work

1. API: overview; first-message cap; integration tests.
2. Dashboard: Overview page, i18n (en, he). App: the slow-down message in chat, i18n ×4.
3. e2e `pnpm --dir e2e overview`; docs; PR; CI; merge.
