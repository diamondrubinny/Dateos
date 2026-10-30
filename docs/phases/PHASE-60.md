# Phase 60: Notifications in the web app (Web Push) (v1.32)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.

## The gap (checked)

Phases 57–59 made the web app an installable app: for a community without App Store / Google Play
apps, it **is** the app. But on the web, Settings → Notifications says "Notifications are available in
the mobile app": no notification for a new match, a message, an incoming call or a safety check-in.
On the phone app they all exist (phase 3b), with no names or message text, quiet hours (39), muted
chats (31) and choices per kind (33).

## What changes

| Part           | Change                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keys (VAPID)   | The install command makes a key pair for the server (`WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, OpenSSL); existing servers get one on their next run of the install command. Without keys: off                                                                    |
| API            | `GET /v1/push/web` (the public key, or "off"); `POST/DELETE /v1/me/web-push` (a browser's subscription), only for known push services (an allow-list: Google, Mozilla, Apple, Microsoft) 📘                                                                           |
| Worker         | The same notifications as the phone app, through the same rules (choices, quiet hours, muted chats, someone online, throttling), sent with `web-push` (encrypted to the browser; the push service can't read it); subscriptions the service says are gone are deleted |
| Service worker | Shows the notification (the community's name and a generic sentence, as on the phone); a tap opens the chat, the check-in or the event                                                                                                                                |
| Settings (web) | "Notifications on this device", asked only when you turn it on; says when the browser blocks them, and on an iPhone that the app must be on the home screen first 📘                                                                                                  |
| Signing out    | This browser stops getting that account's notifications                                                                                                                                                                                                               |

## Security and privacy ⚖️

- **The worker only posts to known push services**: an address a member gives is checked against the
  allow-list (HTTPS, exact host or a listed suffix), so the server can't be made to call anything else.
- The notification content is encrypted to the browser (RFC 8291) and carries **no names, no
  message text, no photos**: the community's name, a generic sentence, and an opaque id to open the
  right screen. As on the phone app.
- Stored: the subscription address and its two public keys, per account, deleted with the account,
  on sign-out, when turned off, and when the push service says it's gone. The browser vendor's push
  service (Google, Mozilla, Apple or Microsoft) sees that a notification is sent to that browser.
  PRIVACY.md and the cookie policy say so ⚖️.
- The private key stays in `.env` on the server (worker only); never sent to clients or logged.

## Accessibility

- A real checkbox with a label and a hint; the browser's own permission prompt only after the member
  turns it on; outcomes (blocked, unsupported, needs the home screen) as text, 4 languages.

## Tested for real

- **Unit** (shared, 3): the allow-list takes the four services and refuses HTTP, other ports,
  credentials in the address, look-alikes (`fcm.googleapis.com.evil.example`), the bare suffix,
  `localhost`, `127.0.0.1`, `169.254.169.254`; the schema takes only what `PushSubscription` gives.
- **Unit** (worker, 3): the install command's keys are a **real pair** (the private key gives exactly
  the public one) and new each run; `web-push` accepts them and builds a VAPID-signed, `aes128gcm`
  request whose body doesn't contain the text; the sender address (https app, else `mailto:`).
- **Integration** (11): the key route; subscribe (401 signed out), the allow-list (400s, nothing
  kept), a browser moves to whoever subscribed last, each removes only their own, at most 10 per
  account; "Download my data" names the service, never the address; off without keys (503). The
  worker: the payload is the community and a generic sentence in the browser's language, no names;
  a muted chat sends nothing while a call rings (`urgency: high`, `TTL: 60`); a 410 forgets the
  browser; an address outside the allow-list already in the database is never posted to (and is
  removed).
- **install.sh** in a temporary copy: both keys in `.env` (87 and 43 characters), `.env` 600.
  shellcheck clean.
- **e2e** `pnpm --dir e2e web-push` (en, he): turning it on (permission granted) sends the
  subscription; a push delivered to the real service worker through Chrome DevTools shows "NexaHeart /
  You have a new message" (Hebrew in Hebrew), no names, set to open `/chat/<id>`; off and sign-out
  remove it from the server. axe 0. Screenshot `138-web-push-on`.

Found on the way: Chrome has no Push API in incognito windows (Playwright's default), and a real
subscription needs Google's servers, which the test machine can't reach; the e2e replaces only the
browser's subscribe call, as its header says.

### Known limits

- 📘 Real delivery through Google, Mozilla, Apple and Microsoft's services, and on an iPhone with the
  app on the home screen, is not yet tried (the sandbox can't reach them). The request format is
  checked against the library and the specs (RFC 8030, 8291, 8292).

## Order of work

1. Shared: endpoint allow-list, schemas (unit tests). DB: `web_push_subscriptions`.
2. API: key route, subscribe/unsubscribe (integration tests: ownership, allow-list, limits).
3. Worker: send through `web-push` beside Expo; gone subscriptions removed (tests with a local fake
   push service).
4. Service worker: `push` and `notificationclick`. App: settings toggle, sign-out; i18n ×4.
5. Install: key pair in `install.sh` and for existing servers in `bootstrap.sh` (CI: valid keys).
6. e2e `pnpm --dir e2e web-push`: turn it on (permission granted), the subscription reaches the
   server; a push delivered to the service worker (Chrome DevTools) shows the community's notification
   with no names; a tap opens the chat; off and sign-out remove it. axe 0. Screenshots.
7. Docs (PRIVACY, cookie policy, INSTALL en/he, SELF_HOSTING, CHANGELOG), PR, merge.
