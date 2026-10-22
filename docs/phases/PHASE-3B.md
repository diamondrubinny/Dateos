# Phase 3b: Voice messages and push notifications

> Status: ✅ done (2026-10-21). 📘 = verify against official docs, ⚖️ = needs legal review.

## Scope

| #   | Deliverable                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Voice messages** up to 60 s in a chat. Same unlock rule as images (3+3 text messages first), so a stranger's first contact cannot be a voice note                                                                                                                        |
| 2   | **Audio pipeline**: quarantine → magic-byte check (MP4/M4A, WebM, Ogg only) → ClamAV → **re-encode with ffmpeg** to AAC/M4A, mono, 48 kbit/s, metadata stripped, hard 60 s cut. ffmpeg runs without a shell, with a whitelist of input formats and protocols and a timeout |
| 3   | **Receiver control (accessibility)**: "Accept voice messages" setting. People who can't hear them (or don't want them) turn it off; senders see a clear message                                                                                                            |
| 4   | **Reports include voice evidence**: reporting a chat copies the reported voice notes into evidence storage, so moderators can listen (audited), even after the chat is purged                                                                                              |
| 5   | **Push notifications** (opt-in, native apps): new match, new message. Content is **never** in the notification: only "New message" / "It's a match" without names or text, because notifications pass through Expo, Apple and Google ⚖️                                    |
| 6   | Push sending through a worker queue: at most one push per conversation per 2 minutes, no push while the person has the app open (WebSocket presence), invalid tokens removed automatically                                                                                 |
| 7   | App: record / stop / cancel / send buttons (no press-and-hold gesture), player with play/pause and duration, settings toggles for push and voice                                                                                                                           |

## Data model

| Table / column                                 | Purpose                                                         | Retention                                                   |
| ---------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| `audio_clips`                                  | user, status, quarantine/media keys, duration_ms, reject_reason | with the message; purged with closed chats (30 days)        |
| `messages.kind = 'voice'`, `messages.audio_id` | voice message                                                   | as messages                                                 |
| `report_evidence.media_key`, `kind`            | copied voice evidence                                           | with the report (12 months) ⚖️                              |
| `preferences.accept_voice` (default true)      | receiver control                                                | account lifetime                                            |
| `push_tokens`                                  | user, Expo token, platform, last_used_at                        | until sign-out, opt-out, invalid token, or account deletion |

## API

| Endpoint                                               | Notes                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `POST /v1/matches/:id/voice` (multipart)               | participants only, unlocked chats, receiver accepts voice, ≤ 2 MB |
| `GET /v1/audio/:id`                                    | participants of an active match only (like chat images)           |
| `PUT /v1/me/settings` `{acceptVoice}`                  |                                                                   |
| `POST /v1/me/push-tokens`, `DELETE /v1/me/push-tokens` | Expo push token format validated                                  |
| `GET /v1/admin/reports/:id/evidence/:evidenceId/audio` | staff + MFA, audited                                              |

## Threat model additions

| Threat                                                     | Control                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious media file (parser exploits in ffmpeg)           | Magic-byte whitelist, ClamAV, ffmpeg with `-protocol_whitelist file`, explicit input demuxer, no network, no shell, 20 s timeout, output size cap. 📘 Keep ffmpeg patched; consider a sandbox (seccomp/container) in production |
| Voice spam / unsolicited content                           | Unlock rule, receiver can turn voice off, per-user rate limit, reports with audio evidence                                                                                                                                      |
| Notification content leaking (lock screens, third parties) | No names or text in pushes                                                                                                                                                                                                      |
| Token theft / spoofing another user's device               | Tokens are bound to the session's user; a token re-registered by another user moves to them; deleted on sign-out                                                                                                                |

## Tests

Unit: format sniffing, ffmpeg argument building, push payload has no personal data, throttle.
Integration: voice gate, receiver opt-out, participants-only playback, transcoding with real ffmpeg (WebM → M4A, duration cap, rejected non-audio), push queue to a fake Expo endpoint (payload, invalid-token cleanup, throttle, online suppression), evidence copy and staff playback.
E2E: record (web, fake microphone) → send → the other person plays it; screenshots; axe.

## Decisions made while building

- **Two renditions per voice message.** AAC/M4A plays on iOS, Android, Safari and Chrome, but Chromium builds without proprietary codecs (common on Linux, and the e2e browser) cannot play it. The worker also writes Opus/WebM, and players pick whichever the device supports.
- **Online presence** is a short-lived Redis key refreshed by the WebSocket heartbeat, so pushes are skipped while the person has the app open, across several API instances.
- **Media pushes**: only text messages and new matches trigger a push. Images and voice notes appear once scanned, and the conversation's next text triggers a push anyway.

## Results

| Check                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                             | worker 14 (real ffmpeg: WebM/Opus, Ogg, M4A in; AAC + Opus out, metadata stripped, 60 s cut, broken and non-audio files rejected; ffmpeg protocol whitelist; push text has no personal data)                                                                                                                                                                                                                                                                                                                                                                    |
| Integration tests                      | **79 passed** (8 new): unlock rule, receiver opt-out, 415/413, the real worker pipeline (hidden until re-encoded, both renditions, participants only, gone after unmatch, purged with the chat after 30 days), undecodable recordings rejected, voice evidence copied, playable by staff (audited, survives the chat purge), push token validation and ownership moves, push queued for receiver and new match, fake Expo server: payload without names or text, access token, 2-minute throttle, online suppression, dead-token cleanup, nothing after a block |
| Mutation tests                         | Removing the receiver opt-out, the push throttle, or the "active match" check on playback each makes the suite fail                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Two-browser e2e (en + he)              | Record with a synthetic microphone → stop → send → ClamAV + ffmpeg → the other person plays it live; turning voice off in Settings stops the sender, with an explanation                                                                                                                                                                                                                                                                                                                                                                                        |
| Regression                             | Chat (phase 3) and safety (phase 4) e2e pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| axe-core WCAG 2.1 A/AA (8 new screens) | **0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Bugs found and fixed during this phase

1. **AAC doesn't play in every browser** (found by the e2e): an Opus rendition was added, chosen per browser.
2. **The read-receipt route was deleted by one of my own edits** (an over-greedy replacement while adding the audio route). The chat e2e caught it ("Seen" never appeared). Restored, and the integration suite was confirmed to fail without it.
3. **`MALWARE_SCAN` value in the self-hosting guide was wrong** (`off` instead of `disabled`).

## Known limitations

- Push notifications need your own EAS build (project id) and real devices to verify delivery; the server side is tested against a fake Expo endpoint 📘.
- No web push (PWA) yet: notifications are for the native apps.
- Voice messages are not transcribed, so people who can't hear them should turn them off (the sender is told). Local transcription (e.g. Whisper) is a possible later addition.
- ffmpeg parses untrusted files: keep the worker image updated and consider extra sandboxing (seccomp, separate container) in production.
