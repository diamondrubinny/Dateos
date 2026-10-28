# Phase 30: Chat control: unsend, replies, read receipts (v1.3)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

Three things people expect from a modern chat, designed so they don't weaken safety.

## 30a. Unsend a message

- My own text, photo or voice message can be **unsent within 15 minutes**. Both of us then see
  "Message unsent" in its place; the other person's app updates live.
- **Safety first:** an unsent message is hidden from both people but **kept on the server for 30
  days**, only for moderation. If the other person reports me within that time, my unsent messages
  in our chat are added to the report as evidence automatically (marked "unsent"), because they
  can't select what they no longer see. After 30 days a daily job deletes the content (and the
  photo or recording). ⚖️ Explain this in the privacy policy (legitimate interest: safety).
- Date cards and call lines can't be unsent (they have their own cancel flows).
- Reactions and replies to an unsent message go with it (the reply keeps "Message unsent").

## 30b. Replies

- The message menu (the small button under each message, also used for reactions) has **Reply**:
  the quote (first 120 characters, or "Photo" / "Voice message") shows above the composer and in
  the sent message, read aloud as "Replying to Dana: …".
- The quoted message must be in the same chat. A quote of a hidden (harmful) message shows
  "Hidden message" to its receiver; of an unsent one, "Message unsent".

## 30c. Read receipts, your choice

- Settings → Chat: **Read receipts** (on by default). Off: the other person doesn't see "Seen" for
  my reading, and, fairly, I don't see theirs either (like most chat apps).
- Unread counts still work (they're mine, not shown to anyone).

## API

| Method | Path                                  | Notes                                         |
| ------ | ------------------------------------- | --------------------------------------------- |
| DELETE | `/v1/matches/:id/messages/:messageId` | unsend: sender only, 15 minutes; else 404/409 |
| POST   | `/v1/matches/:id/messages`            | now with optional `replyToId`                 |
| PUT    | `/v1/me/settings`                     | now with `readReceipts`                       |

## Data

- `messages.unsent_at`, `messages.reply_to_id` (same chat, `ON DELETE SET NULL`).
- `preferences.read_receipts` (default true).
- Worker: `purgeUnsent` daily: content of messages unsent more than 30 days ago (body, photo,
  recording) is deleted; the row stays as "Message unsent".
- Migration `0039_chat_control.sql`.

## Security and privacy checks

- Unsend: the server checks the sender, the chat (404 for anyone else) and the time window.
- A reply id from another chat is refused (400), so quotes can't leak other conversations.
- Unsent content never appears in any API response for members, in exports of the other person,
  or in push notifications. The sender's own "Download my data" still has it until it's purged.
- Audit: `message.unsent` (ids only).

## Order of work

1. Shared schemas, db, migration; API + worker; integration tests.
2. App: unsend and reply in the message actions, quote above the composer and in bubbles, read
   receipts switch; i18n in 4 languages.
3. e2e `pnpm --dir e2e chat-control`, docs, PR, CI, merge.
