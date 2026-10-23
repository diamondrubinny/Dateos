# Phase 26: Voice message transcripts (v1.1)

> Status: ✅ done (2026-10-23). Approved: "Voice transcripts (recommended)": a local Whisper
> model on the server, no outside service.
> 📘 = verify against official docs, ⚖️ = needs legal review.

The accessibility statement lists one known limitation: **voice messages have no transcript**. A
deaf or hard-of-hearing member can't read them, and nobody can read one on a quiet bus. This phase
adds a "Show text" button to every voice message and voice prompt, transcribed **on the
community's own server** by an open speech model (Whisper). The voice never leaves the server.

## 26a. How it works

- **On demand only.** Nothing is transcribed until someone who may listen to the clip taps
  **Show text** (data minimisation, and no CPU spent on clips nobody needs as text). The text is
  then kept with the clip, so the other person gets it at once, and is deleted with the clip.
- **Automatic for those who need it:** a member who shared `deaf_hoh` (phase 25) sees text appear
  by itself under each voice message.
- **The speaker decides.** Settings → "Let people read my voice messages as text" (on by default,
  with a plain explanation). Off: "Show text" says "{{name}} prefers voice only". ⚖️ whether on by
  default is right where you operate.
- **Language:** the app sends its language with each recording (`he`, `en`, `ar`, `ru`); Whisper is
  told that language (it would otherwise assume English 📘).
- **The text is marked as automatic** ("Automatic transcript, may contain mistakes") and is only
  shown to people who may already play the clip (the two people of an active, unblocked match, or
  anyone who may see the profile for a voice prompt), checked on the server.

## 26b. The model

| Setting             | Default                       | Notes                                                                                                           |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `TRANSCRIPTS`       | `local` (`off` turns it off)  | `off`: no "Show text" button anywhere (`/v1/instance` says so).                                                 |
| `TRANSCRIPTS_MODEL` | `onnx-community/whisper-base` | ~77 MB, ~2 s per 10 s of speech on one CPU core. `whisper-small` (~250 MB) is better for Hebrew and Arabic 📘.  |
| `TRANSCRIPTS_CACHE` | `/models` (a Docker volume)   | Downloaded from Hugging Face once, on the first transcript; or copy the files there yourself (offline servers). |

- Runs in the **worker** through [Transformers.js](https://huggingface.co/docs/transformers.js)
  (ONNX Runtime, no Python, no GPU needed) 📘. One transcript at a time (a dedicated queue with
  concurrency 1), at most the voice message length limit (2 minutes), with a timeout.
- The clip is decoded with the ffmpeg the worker already has (16 kHz mono).
- Model licence: Whisper is MIT-licensed 📘.

## API

| Method | Path                       | Who                           | What                                                                                                                                                                  |
| ------ | -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/audio/:id/transcript` | someone who may play the clip | Returns `{ status: 'done', text }`, or `{ status: 'pending' }` and queues the job; `unavailable` when the speaker turned it off or transcripts are off. Rate-limited. |
| GET    | `/v1/audio/:id/transcript` | same                          | The current state, without queuing.                                                                                                                                   |
| PUT    | `/v1/me/settings`          | member                        | `{ allowTranscripts: boolean }` (with the other chat settings): the speaker's choice; turning it off deletes existing transcripts of their clips.                     |

- The realtime event `message.updated` tells the chat when a transcript is ready.
- Voice uploads accept `lang` (one of the app's languages).

## Data (new)

- `audio_clips.lang varchar(5)`, `audio_clips.transcript text`, `audio_clips.transcript_status
varchar(12)` (`pending` / `done` / `failed`); `preferences.allow_transcripts boolean default true`
  (migration `0030_transcripts`).
- Data map: the transcript is derived from the voice message, same purpose and retention (deleted
  with the clip, at the latest by the voice message retention), in "Download my data" for the
  speaker. Processed only on the community's server.

## Security and privacy

- Access is the same check as playing the clip (one shared function); IDOR tests.
- Never logged; not sent to the AI features (icebreakers, coach), not shown to moderators unless the
  reporter includes the message in a report (then like the message: the clip, not the text).
- The model is downloaded over HTTPS from a fixed host; the download can be avoided by providing
  the files. No audio is sent anywhere.

## Order of work

1. shared, db: schemas, migration, instance flag.
2. worker: transcriber (Transformers.js + ffmpeg), queue, job; tests with a fake model and one real
   run on generated speech.
3. API: the endpoints, upload `lang`, speaker setting, export; integration tests.
4. Mobile: "Show text" in voice messages and voice prompts, automatic for `deaf_hoh`, the setting,
   i18n in 4 languages.
5. Infra and docs: compose volume, `.env.example`, install, accessibility statement (the limitation
   goes away), PRIVACY, SELF_HOSTING, CHANGELOG.
6. e2e (`pnpm --dir e2e transcripts`): a real recorded clip (fake microphone with generated speech),
   the real model, all 4 languages for the UI; PR, CI, merge.

## Results

- **Built:**
  - Worker: `transcribe.ts` (ffmpeg to 16 kHz mono, then Whisper through Transformers.js 3.8.1 on
    ONNX Runtime, loaded on the first job) and `transcript-jobs.ts` (the job, the speaker's choice
    re-checked, the clip's language or the community's, realtime `message.updated`). Its own queue,
    one clip at a time, two attempts.
  - API: `GET`/`POST /v1/audio/:id/transcript` with the same access check as playing (one shared
    function), an atomic claim so a clip is queued once, `allowTranscripts` in the chat settings,
    `lang` on voice uploads, `transcripts` in `/v1/instance`, the text in "Download my data".
  - App: "Show text" under voice messages and voice prompts (automatic with `deaf_hoh`), states for
    working, failed (try again) and "voice only", the speaker's setting, 4 languages.
  - Infra: a `models-data` volume, `TRANSCRIPTS*` settings, and a worker image pruned to the CPU
    runtime for Linux (the transcripts add about 94 MB instead of about 500 MB).
- **Tests:**
  - Integration: 8 new (asked once, language, access and blocks, "voice only" before and during a
    job, retry after nothing was heard, community language fallback, export, decoding our own
    rendition, turned off); 212 in total, all passing.
  - e2e `pnpm --dir e2e transcripts` with the **real model**: generated English speech through a fake
    microphone comes back as "Hello Dan, would you like to meet for coffee on Thursday evening?";
    automatic text for `deaf_hoh` (Hebrew); "voice only"; all 4 languages; axe 0 violations.
  - The voice and chat e2e suites pass again.
- **Found and fixed while testing:**
  - A realtime event sent while a browser was still connecting was lost, so a voice message could
    stay invisible to the other person until a reload (also before this phase). The app now
    refreshes its chats whenever the connection opens.
  - Transformers.js 4 downloads its runtime in an install script, which failed behind a proxy;
    3.8.1 ships it in the package.
  - A failed job kept its id in the queue, so asking again would never run; the API now claims the
    clip atomically and queues a fresh job.
- **Still to check:**
  - ⚖️ "Let people read my voice messages as text" is on by default; the speaker can turn it off.
  - 📘 Quality in Hebrew and Arabic with `whisper-base` is modest; `whisper-small` is better and
    slower. Test with real voices before choosing.
  - The worker image could not be built in this environment (its proxy blocks the registry inside
    Docker); the same deploy and pruning steps were run directly and transcribed correctly. CI builds
    the image.
