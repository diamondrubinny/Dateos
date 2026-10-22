# Phase 15: Video dates (v0.3, part 4): plan

> Status: 📝 plan, waiting for approval. 📘 = verify against official docs, ⚖️ = needs legal review.

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
  hour. After 2 declined invitations in a row, the caller has to wait until the other person writes.

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
  (generated by `install.sh`, never committed), `CALL_MAX_MINUTES` (default 60).
- Compose: a `livekit` service in a new `video` profile. Its config file is generated in
  `infra/data/livekit/` (ignored by git). Caddy serves `rtc.<domain>` → `livekit:7880` (signalling over
  WSS).
- Firewall: TCP 7881 and UDP 7882 (single-port UDP mux), and TURN on UDP 3478 / TLS 5349 for strict
  networks 📘.
- Dashboard: "Video dates" switch on the Community page (shown only when LiveKit is configured), and
  the maximum call length.

## 4. Security, privacy and accessibility

### Threats and controls

| Threat                                  | Control                                                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unwanted or repeated calls (harassment) | Unlocked chats only, receiver opt-out, invitation must be accepted, rate limits, cooldown after declines, block ends everything                                                                          |
| Indecent exposure                       | Camera off on join, one-tap end and report, moderators see the call log; no AI scanning of video (privacy)                                                                                               |
| A stolen or replayed token              | 2-minute token, one room, identity bound to the member, at most 2 participants, the room is deleted when the call ends                                                                                   |
| Revealing where someone is (IP address) | SFU: peers only ever see the server; IP addresses only in the server's short-lived logs (the existing 50 MB log limits)                                                                                  |
| The operator watching calls             | Not recorded (no egress service is installed). Media is decrypted in the server's memory while being forwarded: said plainly in the privacy policy ⚖️. Optional end-to-end encryption is a later step 📘 |
| Forged webhooks                         | LiveKit's signed webhooks only; an unknown room or call is ignored                                                                                                                                       |
| Server overload (DoS)                   | Rate limits, a maximum number of calls running at once, the time limit                                                                                                                                   |
| Recording by the other person           | Can't be prevented technically: a clear notice before the first call, and reporting ⚖️ (recording laws differ between countries)                                                                         |

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

## 6. Open decisions

1. **LiveKit, self-hosted** (recommended) or one of the alternatives above.
2. **Off by default** per community, turned on in the dashboard (recommended), or on whenever LiveKit is
   configured.
3. **Default maximum length**: 60 minutes?
4. **Voice-only calls** in the same feature (recommended: almost no extra work, and it helps people
   who don't want to be on camera).
5. **End-to-end encryption** now (LiveKit supports it on the web; native support needs checking 📘), or
   later as a separate step (recommended: later, after the basic feature is proven).
