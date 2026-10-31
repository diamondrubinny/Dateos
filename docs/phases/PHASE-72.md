# Phase 72: A harder-wearing web app: declarative push, the badge, notification actions, passkey signals (v1.56)

> Status: ✅ done (2026-10-31). 📘 = verify against official docs, ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 72: Declarative Web Push, the Badging API,
> actions on notifications and the WebAuthn Signal API ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)),
> with the badge off in discreet mode (phase 67).

## What's here today (checked in the code)

- Web Push (phase 60): an encrypted `{title, body, kind, id}` that only our service worker can turn
  into a notification. Safari's declarative push can't show it without the worker.
- No badge on the installed app's icon; no buttons on notifications.
- Passkeys (phase 21) can be removed in Settings → Security, but the device's password manager
  keeps offering the removed one.

## What changes

| Part                                  | Change                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Declarative Web Push 📘               | The same encrypted push also carries the declarative form (`web_push: 8030`, a `notification` with title, body, the screen to open and the badge). Browsers that support it show it even when the worker isn't running; others still use the worker, which reads both forms. Nothing new is revealed: the same generic text and opaque id. |
| The badge on the app icon             | The number of chats with unread messages, set by pushes and by the app while it's open, cleared when nothing is unread. Settings → Notifications: "Show a number on the app icon" (on by default). Off whenever discreet notifications are on (phase 67): a number on a hidden app is a clue.                                              |
| A button on the check-in notification | "I'm OK" right on the safety check-in reminder: it opens the app, which confirms, as the button there does.                                                                                                                                                                                                                                |
| Passkey signal 📘                     | Removing a passkey also tells this device's password manager the credential is gone (WebAuthn Signal API), where the browser supports it.                                                                                                                                                                                                  |

## Security and privacy ⚖️

- The badge is a number only, never a name; off with discreet notifications. The declarative form
  carries exactly what the encrypted payload already did.
- The check-in action does what the in-app button does, for the signed-in member only.

## Tests

- Unit (worker): the payload has both forms; the badge counts chats with unread messages; no badge
  when turned off or with discreet notifications; the check-in action only on check-ins.
- Integration: the setting saved and exported.
- e2e (en, he): the setting in Settings; `/checkin?ok=1` confirms an active check-in; the service
  worker shows the declarative form with the action. axe 0. Screenshot.

## Done

- **Integration** (`web-push.test.ts`, "phase 72"): the payload carries the declarative form
  (`web_push: 8030`, the screen as an absolute link, the language, the number) only when the app's
  address is known; the number counts chats with unread messages and not muted ones; "I'm OK" on
  check-ins only, opening `/checkin?ok=1`; turned off, no number; discreet, no number and no
  button. The setting is in Settings and the export (`voice.test.ts` updated for it).
- **e2e** `pnpm --dir e2e pwa-hardening` (en, he): `/checkin?ok=1` confirms the active check-in;
  the app sets 1 on its icon for one unread chat and clears it when turned off; discreet
  notifications show a note instead of the setting; the service worker shows a push sent only in
  the declarative form, with "I'm OK" (through Chromium's test hook). axe 0. Screenshot
  `187-app-badge` (en, he).
- The passkey signal (`signalUnknownCredential`) runs after removing a passkey where the browser
  has it 📘; it can't be tested headless (no platform authenticator).
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- The number on the phone app's icon (Expo's badge field), and a neutral replacement manifest.
- A generic "send to the server" action (e.g. replying from the notification): actions only open
  screens, so nothing is sent without the app.
