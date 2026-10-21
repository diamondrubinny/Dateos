# Phase 3: Real-time chat, safety filters, AI icebreakers

> Status: ✅ done (2026-10-22) for chat. Voice messages and push notifications move to phase 3b. 📘 = verify against official docs, ⚖️ = needs legal review.

## Scope

| #   | Deliverable                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Messages** per active match: text (≤ 2,000 chars) and images. Cursor pagination, idempotent sends (`clientId`), read receipts                                                                                                                          |
| 2   | **Real-time** over WebSocket (`/v1/ws`), authenticated with the session cookie. Fan-out through Redis pub/sub so several API instances work. Events: `message.new`, `message.read`, `typing`, `match.closed`                                             |
| 3   | **"Are you sure?"**: a local, multilingual (EN/HE) check of outgoing text for insults, threats and sexual harassment. The sender sees a warning before sending. The check is advisory, so the sender can still choose                                    |
| 4   | **Receiver protection**: messages that the same check flags are delivered **hidden** behind "Show message"                                                                                                                                               |
| 5   | **Scam warnings**: requests for money, gift cards or crypto, and early moves to other apps, show a safety banner to the recipient                                                                                                                        |
| 6   | **Images in chat**: allowed only after both people have sent at least 3 messages. They go through the existing quarantine → ClamAV → re-encode pipeline and are **blurred until tapped**                                                                 |
| 7   | **AI icebreakers**: 3 openers based on the other person's prompts. Default: local templates (no AI). Optional: a local LLM via Ollama. Profile text is untrusted input; output is validated (length, no links or contact details) with template fallback |
| 8   | Unmatch or block closes the chat in real time for both people                                                                                                                                                                                            |
| 9   | Mobile: chat screen, matches list with last message and unread count, icebreakers, warnings, blurred images                                                                                                                                              |
| 10  | Tests (unit, integration, two-browser real-time e2e) + screenshots                                                                                                                                                                                       |

**Deferred to phase 3b (stated openly):** voice messages (needs an audio transcoding + scanning pipeline) and push notifications (needs device testing and an Expo push integration).

## Data model

| Table            | Columns                                                                                                                                 | Retention                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `messages`       | id, match_id → matches (cascade), sender_id, client_id (unique per sender), kind (text/image), body, photo_id, flags text[], created_at | Deleted with the match or account. Messages in unmatched chats are purged after 30 days (until reporting lands in phase 4) ⚖️ |
| `match_reads`    | match_id, user_id, last_read_at                                                                                                         | with the match                                                                                                                |
| `photos.purpose` | `profile` / `chat`                                                                                                                      | chat images are never shown on profiles                                                                                       |

## API

| Endpoint                                           | Notes                                                    |
| -------------------------------------------------- | -------------------------------------------------------- |
| `GET /v1/matches/:id/messages?before=&limit=`      | participants only, otherwise 404                         |
| `POST /v1/matches/:id/messages` `{text, clientId}` | rate limited; returns the stored message with flags      |
| `POST /v1/matches/:id/images` (multipart)          | only after 3+3 messages; scanned before delivery         |
| `POST /v1/matches/:id/read`                        | updates read receipt, notifies the other side            |
| `POST /v1/messages/check` `{text}`                 | "Are you sure?" pre-check; nothing is stored or logged   |
| `GET /v1/matches/:id/icebreakers`                  | 3 suggestions                                            |
| `GET /v1/ws`                                       | WebSocket; events only for the user's own active matches |

## Threat model additions

| Threat                                           | Control                                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading or writing in someone else's chat (IDOR) | Every query is scoped to the match _and_ the participant; non-participants get 404, and the WebSocket only joins the user's own matches                   |
| Unsolicited explicit images                      | No images until both people have chatted (3+3); every image is blurred until tapped; ClamAV + re-encode; image messages stay hidden until the scan passes |
| Harassment                                       | Sender pre-check; flagged messages hidden for the receiver; block in one tap                                                                              |
| Romance scams                                    | Pattern warnings to the receiver (money, crypto, gift cards, moving off-platform)                                                                         |
| Prompt injection via bios into the LLM           | Profile text is passed as quoted data, output filtered (no URLs, emails or phone numbers, ≤ 160 chars), template fallback                                 |
| Message content in logs                          | Bodies are never logged; `text` and `body` are redacted                                                                                                   |
| WebSocket abuse                                  | Auth on connect, per-connection message rate limit, max payload 4 KB, heartbeat timeout                                                                   |

Note: chats are **encrypted in transit (TLS) and at rest (disk/volume encryption by the operator)**, but not end-to-end. E2EE conflicts with abuse reporting and is planned as a later, opt-in design (see PLAN §16).

## Tests

- Unit: toxicity and scam detectors (EN/HE, true and false positives), icebreaker validation.
- Integration: participants only, pagination, idempotency, read receipts, image gate, flags, unmatch/block closes the chat, WebSocket auth and delivery, deletion cascade.
- E2E: two browsers chatting live, screenshots, axe-core.

## Results

| Check                                                           | Result                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                                                      | ai 31 (harm/scam detectors with false-positive cases, icebreakers, locale checks), shared 17, api 22, worker 9, mobile 5                                                                                                                                                                        |
| Integration tests (isolated test DB, Redis DB 15, test buckets) | 51 passed. New for chat: participants only, idempotency, pagination, hidden harmful messages, scam signals, image gate, chat-image access, read receipts, inbox, unmatch/block closes chat, icebreakers, deletion, WebSocket auth (401), Origin check (403), live delivery, per-user rate limit |
| Two-browser e2e (he + en)                                       | Live delivery without reloads, read receipts, "Are you sure?", hidden message, receiver-only scam banner, image unlock + blur                                                                                                                                                                   |
| axe-core WCAG 2.1 A/AA (46 screens)                             | 2 issues found (button role overridden by list item, unfocusable scroll region) → fixed → **0**                                                                                                                                                                                                 |
| Ollama icebreakers                                              | Injection attempt blocked (template fallback). `qwen2.5:1.5b` Hebrew output failed quality checks 6/6, so templates were used: a stronger multilingual model is needed for LLM icebreakers in Hebrew                                                                                            |
| Closed-chat purge                                               | Manual run: messages and chat images (row and file) of a 31-day-old unmatch deleted, active chat untouched                                                                                                                                                                                      |

## Bugs found and fixed during this phase

1. **Integration tests wiped the developer's data.** They ran `TRUNCATE` on the dev database. They now use `<db>_test`, Redis DB 15 and separate buckets, and leave dev data untouched (verified: 14 users before and after).
2. **SeaweedFS ran out of volume slots** when buckets were added (`-volume.max=0` default). Set explicitly in compose.
3. **Rate limits on uploads/messages were per IP.** With carrier-grade NAT this blocks innocent users. They are now per user after authentication; a mutation test proves the difference.
4. **The rate limiter answered 500 when a request had no peer IP.** It now uses a shared fallback key.
5. **Images stayed "locked" after the 3+3 messages** until reload. The app now applies the rule live.
6. **Icebreaker buttons were announced as list items** (`role` overrode the button role).
7. **The chat list wasn't keyboard-scrollable.** Fixed by making it focusable and labeled.
8. **Small LLMs produced mixed-language Hebrew.** A script check rejects it and falls back to templates.
9. **The match screenshot depended on the date** (ranking tie-break). Demo likes are now deterministic.

## Known limitations

- Harm detection is lexicon-based: masked words ("f*ck") and context are missed. Human moderation and reports come in phase 4.
- Not end-to-end encrypted (see PLAN §16).
- Voice messages and push notifications: phase 3b.
