# Phase 16: Waiting lists, then private and accessible calls (v0.4)

> Status: 16a ✅ done (2026-10-22). 16b and 16c: 📝 plans, waiting for approval.
> 📘 = verify against official docs, ⚖️ = needs legal review.

## 16a. Waiting list for full events ✅

When an event is full, members can join its waiting list instead of being turned away.

- **Joining**: "Join the waiting list" on a full event. If a place is free after all, the member is
  simply going. At most 500 people wait for one event; joining twice keeps your place.
- **Your place**: "On the waiting list · Ahead of you: 2". Members see the number of people waiting
  and their own place, **never who**; staff see the count only.
- **Moving up, first come first served**: when someone going says "I can't go after all", or an
  admin raises the capacity (or removes the limit), the next people in line are moved to "going" at
  once, inside the same database transaction that holds the event's lock (no double booking). Each
  gets the usual content-free push ("Update about a community event you are going to").
- **Not after the start**: once the event has started, a freed place stays free, so nobody gets a
  surprise "you're going" for something already happening.
- Reminders the day before go only to people going; cancelling an event tells everyone going **and**
  everyone waiting. Waiting entries follow the same retention as answers (30 days after the event)
  and are in "Download my data" (`you: going | waiting`).

API: `POST /v1/events/:id/waitlist`; `DELETE /v1/events/:id/rsvp` leaves the event or its waiting
list. The event view has `waitingCount` and `waitingAhead`.

### Results

| Check             | Result                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration tests | 2 new: order and place in line, no identities (members, staff), leaving, promotion on a cancelled answer and on a raised capacity with a push, free place means going, no promotion after the start, reminders only for people going, cancel tells people waiting |
| E2E               | A member joins the waiting list of a full event and sees "Ahead of you: 0", in **all four languages**, axe-core **0** violations; screenshot `docs/screenshots/<locale>/58-event-waitlist`                                                                        |

## 16b. End-to-end encryption for calls (plan)

Today audio and video are encrypted on the network but decrypted in the server's memory while LiveKit
forwards them (no recording). With end-to-end encryption (E2EE), the server forwards frames it can't
read.

| Option                                                 | What the server could see                                                                                                             | Cost                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Per-call key from the API                           | Nothing in LiveKit, but the API hands out the key, so whoever runs the API could listen                                               | Small: LiveKit's `ExternalE2EEKeyProvider` (web) / `RNKeyProvider` (native)                                                                                                                       |
| **B. Key agreed between the two phones (recommended)** | Nothing, as long as nobody tampers with the key exchange; a passive operator, a database leak or a compromised LiveKit learns nothing | Medium: each app makes an X25519 key pair per call, sends the public key through the call's signalling, derives the shared key; a short "safety code" both people can compare to detect tampering |

Details for B:

- The apps compute the key (HKDF over X25519, the room name as salt) and never send it anywhere. The
  public keys travel in LiveKit participant attributes (the token would allow only that attribute).
- **Safety code**: 4 emoji derived from both public keys, shown in the call ("compare these out loud").
  Optional, like in Signal and WhatsApp.
- Browsers without Insertable Streams / RTCRtpScriptTransform (older Safari, some in-app browsers)
  can't join E2EE calls. The plan is to show "This browser can't make private calls" rather than fall
  back silently 📘.
- Native: `@livekit/react-native` has E2EE (`RNE2EEManager`), which **must be tested on real
  devices** 📘.
- Things E2EE does not hide: who called whom, when and for how long (needed for safety reports), and
  IP addresses at the server.

Decisions needed:

1. Option B, recommended.
2. E2EE always on for every call (recommended), or an instance setting?
3. Show the safety code? (Recommended: yes, with a short explanation.)

## 16c. Live captions (plan)

Captions in calls help people who are deaf or hard of hearing, and anyone in a noisy place.

**The privacy rule this plan keeps: audio never leaves the phone for transcription.** Cloud speech
services (including the default Web Speech API in Chrome, which sends audio to Google 📘) are
therefore not used.

- **Who transcribes**: each person's own device transcribes **their own** microphone, on the device,
  and sends the text over the call's data channel (encrypted with the call once 16b exists). Text is
  shown live and **never stored**.
- **Consent**: captions are sent only when the other person turned them on ("Show captions"), and the
  speaker sees "Captions are on: your words are shown as text to the other person".
- **iOS**: Apple's speech recognition with `requiresOnDeviceRecognition` 📘.
- **Android**: on-device recognition (Android 12+) 📘.
- **Web**: only where the browser can recognise speech on the device. Chrome's on-device option is new
  📘. Otherwise the caption button says "Not available in this browser".
- **Languages**: Hebrew, English, Arabic and Russian, where the device supports them 📘. Quality differs
  by device and language, and the app says so.
- **Technical change**: join tokens will allow sending data, limited to captions. The token today
  allows no data at all; the server would still drop anything that isn't a caption.

Decisions needed:

1. The privacy rule above (on-device only, nothing stored). Recommended.
2. Build 16c after 16b, so captions travel inside the encrypted call. Recommended.
3. Accept that captions won't work on some browsers and older phones. The alternative, a speech model
   on our server, means sending audio to the server and costs CPU per call. Recommended: accept.

## Order

16a is done. Then 16b, then 16c, each after approval and each with integration tests, a two-browser
e2e test (web) and a manual checklist for phones.
