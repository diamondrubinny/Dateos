# Phase 15: Video dates (v0.3, part 4)

> Status: ✅ done (2026-10-22): all recommendations approved; native apps await a test on real devices. 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: two people who matched can have a short **video (or voice-only) call inside the app** before
meeting, without exchanging phone numbers. A video date is a strong safety tool: you see that the
person is who their photos say, and you can end it with one tap.

## 1. Technology decision

| Option                                 | Pros                                                                                                                                                                                          | Cons                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LiveKit, self-hosted (recommended)** | Apache-2.0; one Go service with a Docker image (`livekit/livekit-server`, v1.13.x); built-in TURN; SDKs for web and React Native (Expo plugin); server-side rooms, tokens and signed webhooks | One more service to run, with UDP/TCP ports open; uses bandwidth (about 1–3 GB of server traffic per hour of a 1:1 call)                                                      |
| Peer-to-peer WebRTC + coturn           | Least server bandwidth when a direct path works                                                                                                                                               | Each person's IP address is revealed to the other unless every call is forced through TURN; we'd write and maintain signalling ourselves; harder to end calls from the server |
| Jitsi Meet                             | Mature, full product                                                                                                                                                                          | Several containers; built for meetings, not 1:1 calls; awkward to embed in a React Native app                                                                                 |
| A hosted service (LiveKit Cloud, etc.) | No server to run                                                                                                                                                                              | Media goes through a third party (a DPA and an international transfer to check ⚖️); goes against "your community, your server". Still possible: `LIVEKIT_URL` can point to it |

Why LiveKit: with an SFU, members never see each other's IP addresses (only the community's server
does), the API can remove someone from a call or close a room at once (block, report, suspension), and
the same server works for the web app and the native apps. 📘 Pin the exact server and SDK versions
when building (latest seen: server v1.13.10, `@livekit/react-native` 2.x, `livekit-client` 2.x).

Off by default: video dates work only when the operator runs the `video` profile and sets the keys. The
rest of the app is unchanged without it.

## 2. How it works for members

- **Who can call**: participants of an active match, after the chat is unlocked (the same 3 + 3 text
  messages rule as voice and images), and only if the other person has "Accept video calls" on
  (Settings, default on; turning it off hides the button for the other person).
- **Calling**: a 🎥 button in the chat header → "Video date" or "Voice only". The other person sees a
  full-screen invitation in the app (and a content-free push: "You have an incoming call") with
  **Join** / **Not now**. The invitation expires after 45 seconds and becomes "Missed call" in the chat.
- **In the call**:
  - You join with your **camera off** and choose when to turn it on.
  - Big buttons: microphone, camera, switch camera (phones), end call.
  - **Report** ends the call and opens the report flow; **Block** ends the call at once.
  - A timer shows the time left. The call ends at the community's limit (default 60 minutes).
  - No screen sharing, no in-call chat and no recording in the app. The app says before every first
    call that the other person could record their screen, and to report it ⚖️.
- **In the chat** the call leaves a line: "Video call · 14 min", "Missed call", "Declined".
- **Limits against unwanted calls**: at most 3 invitations per chat per hour, and 10 per member per
  hour. After 2 declined or missed invitations in a row, the caller has to wait until the other person writes.

## 3. Architecture

```
app (web / iOS / Android) ──HTTPS──> API ──server API──> LiveKit (rooms, remove participant)
        │                             ▲
        └──WSS + WebRTC (UDP/TCP)──> LiveKit ──signed webhooks──┘
```

1. `POST /v1/matches/:id/calls` `{ video: boolean }` → the API checks the rules, creates a `calls` row
   (status `ringing`), creates the LiveKit room (random name, `maxParticipants: 2`, short empty
   timeout) and notifies the other person over the existing chat WebSocket and push.
2. `POST /v1/calls/:id/join` → returns a **join token** (JWT signed with the LiveKit secret). The token
   is valid for 2 minutes, for this room only, and allows only camera and microphone (no screen share,
   no data). It is issued only to the two participants, and only while the call is `ringing` or
   `active`.
3. `POST /v1/calls/:id/decline`, `POST /v1/calls/:id/end`.
4. `POST /v1/livekit/webhook`: LiveKit's signed events (participant joined or left, room finished) set
   `answered_at` and `ended_at`. The signature and `Authorization` header are checked; anything
   unsigned is ignored.
5. The worker ends calls that hit the time limit (a delayed job deletes the room) and turns unanswered
   invitations into "Missed call".
6. **Block, unmatch, a report, or a suspension** → the API deletes the room at once.

Web app: `livekit-client` directly. Native apps: `@livekit/react-native` with the Expo config plugin,
in a platform-specific component (`VideoRoom.native.tsx` / `VideoRoom.web.tsx`). The native apps
already need their own build (sign-in doesn't work in Expo Go), so the new native module changes
nothing for operators 📘.

### Data

| Table / field                                | Content                                                                            | Retention                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `calls`                                      | match, caller, video or voice, status, created / answered / ended times, room name | With the chat (deleted when the match is purged); in "Download my data" |
| `messages.kind = 'call'`, `messages.call_id` | the line in the chat                                                               | As messages                                                             |
| `preferences.accept_calls` (default true)    | receiver control                                                                   | Account lifetime                                                        |
| Audio and video                              | **Never stored.** They go through the server's memory only                         | –                                                                       |

Report evidence copies the call lines (time and duration) as text, never media.

### Configuration

- `.env`: `LIVEKIT_URL` (public `wss://rtc.example.org`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
  (generated by `install.sh`, never committed), `RTC_DOMAIN` (Caddy).
- Compose: a `livekit` service in a new `video` profile. Its config file is generated in
  `infra/data/livekit/` (ignored by git). Caddy serves `rtc.<domain>` → `livekit:7880` (signalling over
  WSS).
- Firewall: TCP 7881 and UDP 7882 (single-port UDP mux). TURN over TLS is optional (see changes below) 📘.
- Dashboard: "Video dates" on the Branding page (disabled with an explanation when LiveKit isn't
  configured), and the maximum call length.

## 4. Security, privacy and accessibility

### Threats and controls

| Threat                                  | Control                                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unwanted or repeated calls (harassment) | Unlocked chats only, receiver opt-out, invitation must be accepted, rate limits, cooldown after declines, block ends everything                                                                                                                       |
| Indecent exposure                       | Camera off on join, one-tap end and report, moderators see the call log; no AI scanning of video (privacy)                                                                                                                                            |
| A stolen or replayed token              | 2-minute token, one room, identity bound to the member, at most 2 participants, the room is deleted when the call ends                                                                                                                                |
| Revealing where someone is (IP address) | SFU: peers only ever see the server; IP addresses only in the server's short-lived logs (the existing 50 MB log limits)                                                                                                                               |
| The operator watching calls             | Not recorded (no egress service is installed). Media is decrypted in the server's memory while being forwarded: said plainly in the privacy policy ⚖️. Since [phase 16](PHASE-16.md) calls are end-to-end encrypted, so the server can't decrypt them |
| Forged webhooks                         | LiveKit's signed webhooks only; an unknown room or call is ignored                                                                                                                                                                                    |
| Server overload (DoS)                   | Rate limits, a maximum number of calls running at once, the time limit                                                                                                                                                                                |
| Recording by the other person           | Can't be prevented technically: a clear notice before the first call, and reporting ⚖️ (recording laws differ between countries)                                                                                                                      |

### Privacy

- Camera and microphone permissions are asked only when the member starts or joins a call, with an
  explanation first.
- Push notifications stay content-free.
- The privacy policy, data map and legal drafts get a "Video calls" section ⚖️.

### Accessibility

- Every control has a label and a large target, and works with a keyboard on the web.
- Screen readers announce "Connected", "The other person turned their camera on" and "Call ended".
- RTL layout.
- A voice-only call for people who prefer it.
- Known limitation: no live captions (that would need speech recognition on the device; a later
  step).

## 5. Steps

| Step | Content                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15a  | Shared schemas, DB migration, API (`CallService` behind a small LiveKit interface so tests don't need LiveKit), webhook, worker jobs, settings; integration tests                                                                 |
| 15b  | Compose `video` profile, `install.sh` keys, Caddy route, SELF_HOSTING section; a local LiveKit for dev and e2e                                                                                                                    |
| 15c  | Web call UI, incoming-call screen, chat lines, settings switch, dashboard switch, i18n in 4 languages; e2e with two Chromium browsers and fake camera/microphone, axe                                                             |
| 15d  | Native: `@livekit/react-native` and the Expo plugin, permissions, `VideoRoom.native.tsx`. Checked by typecheck and the Expo config; a **manual test checklist** on real iOS and Android devices (this environment can't run them) |
| 15e  | Privacy policy, data map, legal drafts, README, marketing pages, CHANGELOG, screenshots                                                                                                                                           |

### Tests

- **Integration**: only participants of an unlocked, active match; receiver opt-out; rate limits and
  the cooldown; token scope and expiry; block, unmatch and suspension close the room; webhook
  signatures; missed and ended calls; export; retention with the chat.
- **Unit**: schemas and the call-line text.
- **E2E**: an invitation, join, both see video (fake devices), mute and camera toggle, end, the chat
  line, in four languages with axe; a declined and a missed call.

## 6. Decisions (approved 2026-10-22)

1. LiveKit, self-hosted. 2. Off by default, turned on by an admin. 3. 60 minutes by default (5–120).
2. Voice-only calls included. 5. End-to-end encryption later, as a separate step.

### Changes while building

- **TURN off by default.** ICE over TCP 7881 covers most networks that block UDP; TURN over TLS needs a
  certificate, so it is documented as an option instead of shipped half-configured.
- **No automatic room creation** in LiveKit: only the API creates rooms, so a join token that is still
  valid can't reopen a call that was ended.
- **The cooldown counts missed calls too**, not only declined ones (unanswered invitations are just as
  unwanted).
- The time limit is an instance setting in the dashboard (Branding → Video dates), not an environment
  variable.
- Members appear in LiveKit as `caller` / `callee`, never with their account ids.

## Results

| Check             | Result                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration tests | 8 new: off until enabled (admin, audited), only unlocked chats and participants (no IDOR), receiver opt-out, real join tokens (one room, role, camera only on video calls, no screen share, 2 minutes), decline / hang up / missed / time limit, limits and cooldown, block / report / suspension hang up, signed webhooks only (tampered body refused), evidence as text, export, retention |
| Unit tests        | shared 38 (call schemas and summary)                                                                                                                                                                                                                                                                                                                                                         |
| E2E               | Two Chromium browsers with fake cameras through a **real LiveKit server**: an admin turns video dates on in the dashboard (English, Hebrew); invitation, join, both connected, nobody seen before turning the camera on, the other side sees the camera, mute, hang up, the chat line, a declined voice call. **All four languages**, axe-core **0** violations                              |
| Installer and CI  | `install.sh --domain … --video` writes the env and the LiveKit config; CI validates the compose `video` profile, the Caddyfile with `RTC_DOMAIN`, and that LiveKit parses its config                                                                                                                                                                                                         |
| Native            | TypeScript, the Expo config (permissions, plugins) and the Android JavaScript bundle compile. **Not yet run on devices** (see the checklist below)                                                                                                                                                                                                                                           |
| Screenshots       | `docs/screenshots/<locale>/51–57`, `admin-10-video-dates`, `showcase-calls-<locale>.png`                                                                                                                                                                                                                                                                                                     |

## Bugs found and fixed

1. "Back to the chat" after a call went back one screen; for the person who joined from the invitation
   that was the Matches list. It now always opens the chat.
2. The call screen had a fixed dark background on which the red "Report" button failed contrast (axe).
   The controls now follow the app's light or dark theme; only the video area is black.
3. The Android WebRTC plugin asks for "draw over other apps" (`SYSTEM_ALERT_WINDOW`), which calls don't
   need: it is now blocked.
4. The cooldown first compared the API's clock with the database's; a reply written a moment after a
   call could be missed. Both times now come from the database.

## Manual test on devices (before releasing the native apps) 📘

- iPhone ↔ Android on mobile data and on Wi-Fi: join, camera on/off, switch camera, mute.
- Permissions: first call asks for the microphone, the camera only when turned on; refusing shows the
  explanation and the call continues.
- Earpiece vs speaker, Bluetooth headset, the app going to the background and back, a lost connection
  (reconnects, or the call ends for both).
- The push "You have an incoming call" opens the chat with the Join button.
- VoiceOver and TalkBack: every control is announced; "connected" and the camera changes are read out.

## Known limitations

- No ringing sound or full-screen call notification when the app is closed (CallKit / ConnectionService
  would be a separate step); the push notification and the in-app invitation are the only signals.
- ~~No live captions~~: added in [phase 16](PHASE-16.md), made on the device only.
- ~~No end-to-end encryption yet~~: calls are end-to-end encrypted since [phase 16](PHASE-16.md).
