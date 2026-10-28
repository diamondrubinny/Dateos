# Phase 29: Account security, "undo", reactions, and the developer's credit (v1.2)

> Status: 29a ✅ done (2026-10-28), 29b 🚧 in progress. Two PRs: 29a (security and credit), 29b (features).
> 📘 = verify against official docs, ⚖️ = needs legal review.

## 29a. Account security

### Your devices

Members see where they're signed in and can sign out of a device they don't recognise.

- **Settings → Security → Your devices**: each signed-in device, with a coarse name ("NexaHeart app
  on Android", "Chrome · Windows"), when it signed in and the day it was last active. "This device"
  is marked. The server stores a code (`app:android`, `web:Chrome:Windows`); the app translates it.
- **Sign out** of one device, or **sign out everywhere else** (keeps this one). Each is audited
  (`session.revoked`, `session.revoked_others`, ids only).
- **Privacy:** the browser string and IP address are still never stored (phase 6). Only the coarse
  code is kept, computed once at sign-in and deleted with the session. In "Download my data".
- A signed-out device's open live connection closes at its next heartbeat (within a minute).

### Push tokens bound to the device

Closes the accepted risk from phase 7's security review: someone who learned another person's push
token could move it to their own account, and the other person would stop receiving notifications.

- The app makes a random **device secret** once (kept in the device's secure storage) and sends it
  with the token. The server keeps only a SHA-256 hash of it.
- A token that is already registered moves to another account **only with the same device secret**
  (another person signing in on the same phone). Without it, the request is refused (409).
- Tokens registered before this change take the first secret they're sent with.

### Developer credit, in code

- `CREDIT_AUTHOR` (`Diamond Rubinny`) in `@nexaheart/shared`, next to the credit name and licence.
  `GET /v1/instance` returns it in `poweredBy.author`, and every client shows it.
- The dashboard's footer shows "NexaHeart by Diamond Rubinny · AGPL-3.0 · source".
- `CITATION.cff` at the root; `author` in every `package.json` carries the profile URL.
- `scripts/check-credit.mjs` also checks that the author credit stays.

## 29b. Features

### Undo a pass

- After passing on someone in Discover, Picks or Friends, **Undo** brings them back. It works for
  the last pass only, for 10 minutes. It's free, like everything else.
- Likes can't be undone this way: the other person may already have matched or been notified.
- `POST /v1/interactions/undo` → `{ profile }` (the profile is checked again: still a candidate,
  not blocked). It returns 404 when there's nothing to undo.

### Reactions to messages

- Long-press (or the accessible action "React") on a message to react with one of six emoji:
  ❤️ 😂 😮 😢 👍 🔥. Each person can add one reaction per message; tapping it again removes it.
- The other person sees it live (realtime `chat.reaction`). There's no push notification.
- Not on messages hidden by the harm filter, and not after the match ends. Deleted with the message.
- Accessible: each reaction has a label ("Dana reacted with a heart"), and the picker works with
  the keyboard and a screen reader.

## API

| Method | Path                                  | Who                                    |
| ------ | ------------------------------------- | -------------------------------------- |
| GET    | `/v1/me/sessions`                     | signed-in member                       |
| DELETE | `/v1/me/sessions/:id`                 | the session's owner (other ids: 404)   |
| POST   | `/v1/me/sessions/sign-out-others`     | signed-in member                       |
| POST   | `/v1/me/push-tokens`                  | now with `deviceSecret`                |
| POST   | `/v1/interactions/undo`               | signed-in member                       |
| PUT    | `/v1/matches/:id/messages/:mid/react` | a member of the match (`emoji` / null) |

## Data

- `session.device_label` (varchar 40).
- `push_tokens.device_secret_hash` (char 64).
- `message_reactions` (message, member, emoji, time), unique per message and member, deleted with
  the message or the account.
- Migration `0037_phase29.sql`.

## Security checks

- Session ids from another account: 404, never 403 (no probing).
- Reaction: the server checks the match, that the member belongs to it, and that the message isn't
  hidden; emoji from a fixed list (zod enum).
- Undo: only the caller's own latest pass, only within 10 minutes, and with candidacy checked
  again.
- Per-user rate limits: sessions 30/min, reactions 120/min, undo 30/min.

## Order of work

1. 29a: shared, db, API, tests; mobile "Your devices", device secret; dashboard footer; credit
   check; docs; PR, CI, merge.
2. 29b: shared, db, API, tests; mobile undo button and reactions; i18n in 4 languages; docs; PR,
   CI, merge.
