<div align="center">

<img src="apps/mobile/assets/icon.png" alt="" width="96">

# NexaHeart

**The free, open-source dating platform anyone can run.**
Native iOS & Android plus web from one codebase, privacy by design, and safety built in from day one.
<sub>Formerly called Dateos.</sub>

**[English](docs/marketing/en.md) · [עברית](docs/marketing/he.md) · [العربية](docs/marketing/ar.md) · [Русский](docs/marketing/ru.md)**

[![CI](https://github.com/diamondrubinny/Dateos/actions/workflows/ci.yml/badge.svg)](https://github.com/diamondrubinny/Dateos/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7C3AED.svg)](LICENSE)
[![WCAG 2.1 AA target](https://img.shields.io/badge/accessibility-WCAG%202.1%20AA%20target-067647.svg)](#accessibility)
[![Sponsor](https://img.shields.io/badge/sponsor-%F0%9F%92%9C-ea4aaa.svg?logo=githubsponsors)](https://github.com/sponsors/diamondrubinny)

<img src="docs/screenshots/showcase-en.png" alt="NexaHeart screens: a Discover card with reasons, liking a prompt with a comment, the match screen, Daily Picks and Likes You" width="100%">

<sub>Real screenshots of the current web build, captured automatically by <a href="e2e/screenshots.ts">e2e/screenshots.ts</a>. Profile photos are illustrations; no real people appear.</sub>

</div>

---

## Why NexaHeart?

Most dating apps make money by keeping you swiping, selling "boosts", and monetising your data.
NexaHeart is built the other way around:

- 🆓 **Free for everyone, forever.** No premium tier, no paywalls, no ads, no selling data. MIT licensed.
- 🏠 **Run your own instance.** A city, a community or an organisation can launch a branded dating app with one install script.
- 🛡️ **Safety first.** Photos are scanned for malware and stripped of location data. Location is only ever approximate. Under-18 sign-ups are blocked.
- 🔒 **Privacy by design.** Passwordless sign-in, minimal data, versioned consent, and full account deletion from inside the app.
- 💞 **Reciprocal, explainable matching.** Recommends people likely to be interested _in each other_, explains why, and spreads attention fairly. The algorithm is [published](docs/MATCHING.md).
- 🛟 **Date safety and no ghosting.** A safety check-in emails a trusted contact only if you miss it or press SOS; "close kindly" ends a chat with a polite message instead of silence.
- 💌 **"Likes You" is free.** See everyone who liked you, and like a specific photo or prompt with a comment.
- 💬 **Real-time chat with built-in kindness.** An "Are you sure?" check before hurtful messages, offensive messages hidden for the receiver, scam warnings, and photos that stay blurred until you choose to look.
- 🤖 **AI that respects you.** Matching runs on the instance's own server by default (offline or with a local Ollama model); cloud AI is opt-in only.
- 🌍 **Four languages, accessible.** English, Hebrew, Arabic and Russian (full right-to-left support), screen-reader labels, keyboard navigation, and a button for every gesture.

## Status

NexaHeart is in active development. Here is what works today and what comes next. The full plan is in [`docs/PLAN.md`](docs/PLAN.md).

| Area                                                                                                                         | Status       |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Passwordless email sign-in (magic link), sessions, rate limits                                                               | ✅ Available |
| Profile, preferences, prompts, versioned consents                                                                            | ✅ Available |
| Photo upload with malware scan (ClamAV), EXIF/GPS stripping, re-encoding                                                     | ✅ Available |
| Account deletion (all data and files)                                                                                        | ✅ Available |
| iOS / Android / web app: onboarding, profile, settings (Hebrew + English, RTL)                                               | ✅ Available |
| Approximate location (~1 km grid, bucketed distances)                                                                        | ✅ Available |
| Discovery, reciprocal AI matching, Daily Picks, "why you might click"                                                        | ✅ Available |
| Like / pass / like a photo or prompt with a comment, Likes You, matches                                                      | ✅ Available |
| Unmatch and block                                                                                                            | ✅ Available |
| Real-time chat (WebSocket), read receipts, typing, icebreakers                                                               | ✅ Available |
| "Are you sure?", hidden offensive messages, scam warnings, blurred photos                                                    | ✅ Available |
| Voice messages, push notifications                                                                                           | ✅ Available |
| Report (with chat evidence), moderation dashboard with mandatory TOTP, audit                                                 | ✅ Available |
| Photo verification (live selfie, human review, no face recognition), badge                                                   | ✅ Available |
| Your own instance: setup token claim, branding wizard, HTTPS web server (Caddy)                                              | ✅ Available |
| Download my data, retention jobs, explicit consent for sensitive data                                                        | ✅ Available |
| Safety check-in with SOS to a trusted contact, "close kindly" and reply reminders (anti-ghosting)                            | ✅ Available |
| Date planner: propose a date in a public place your community curates, accept it in the chat, turn it into a safety check-in | ✅ Available |
| Community events: meetups at the community's places, a count of people going (never who), a waiting list when full           | ✅ Available |
| Four languages: English, Hebrew, Arabic, Russian (right-to-left for Hebrew and Arabic)                                       | ✅ Available |
| Video dates: video or voice calls between matches through your own LiveKit, camera off on join, never recorded               | ✅ Available |

## Screenshots

**Discovery and matching**

| Discover                                                                                     | Like a prompt                                                                                        | It's a match                                                                 | Today's picks                                                                   | Likes you                                                                           | Matches                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| <img src="docs/screenshots/en/09-discover.png" width="130" alt="Discover card with reasons"> | <img src="docs/screenshots/en/10-like-comment.png" width="130" alt="Liking a prompt with a comment"> | <img src="docs/screenshots/en/11-match.png" width="130" alt="Match overlay"> | <img src="docs/screenshots/en/12-picks.png" width="130" alt="Daily picks list"> | <img src="docs/screenshots/en/13-likes.png" width="130" alt="People who liked you"> | <img src="docs/screenshots/en/14-matches.png" width="130" alt="Matches list"> |

**Chat with safety built in**

<img src="docs/screenshots/showcase-chat-en.png" alt="Chat screens: icebreaker suggestions, a live conversation with read receipts, the Are-you-sure prompt, a hidden offensive message with a scam warning, and a blurred photo" width="100%">

**Safety: report, verify, moderate**

<img src="docs/screenshots/showcase-safety-en.png" alt="Reporting a scammer from the chat, the photo-verification pose step, the selfie waiting for review, and the suspension screen" width="100%">

| Moderation queue                                                                                                             | Report with chat evidence                                                                                                                 | Selfie review                                                                                                                         | Two-factor setup                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/en/admin-03-reports.png" width="220" alt="Moderation dashboard: report queue sorted by priority"> | <img src="docs/screenshots/en/admin-04-report-detail.png" width="220" alt="Report detail with copied chat messages, profile and history"> | <img src="docs/screenshots/en/admin-06-verification.png" width="220" alt="Selfie next to the profile photos with approve and reject"> | <img src="docs/screenshots/en/admin-02-mfa-setup.png" width="220" alt="Authenticator QR code for staff two-factor setup"> |

**Voice messages**

<img src="docs/screenshots/showcase-voice-en.png" alt="Recording a voice message with a timer, confirming before sending, playing it, and the setting to turn voice messages off" width="100%">

**Date safety and closing kindly**

<img src="docs/screenshots/showcase-safety-date-en.png" alt="Setting up a safety check-in, the active check-in with I'm OK and SOS, closing a conversation kindly, and the card the other person sees" width="100%">

**Plan a date in a place the community trusts**

<img src="docs/screenshots/showcase-date-planner-en.png" alt="Choosing a curated public place and a time, the date card with Accept and Not this time, the agreed date, and the safety check-in already filled in" width="100%">

**Community events**

<img src="docs/screenshots/showcase-events-en.png" alt="Upcoming community events with how many people are going, an event with its place and description, and the member going" width="100%">

**Video dates**

<img src="docs/screenshots/showcase-calls-en.png" alt="An invitation to a video call with Join and Not now, the call with the other person's camera on and the controls, and the call-ended screen" width="100%">

**Privacy**

<img src="docs/screenshots/showcase-privacy-en.png" alt="The Privacy and cookies page listing every stored item, and Settings with Download my data" width="60%">

**Onboarding**

<img src="docs/screenshots/showcase-onboarding-en.png" alt="Welcome, consents (including the explicit consent for sensitive data), profile form, photo upload, prompts and the approximate-location step" width="100%">

**Full right-to-left support (Hebrew):**

<img src="docs/screenshots/showcase-he.png" alt="The discovery screens in Hebrew with right-to-left layout" width="100%">

**Arabic and Russian:**

<img src="docs/screenshots/showcase-ar.png" alt="The discovery screens in Arabic with right-to-left layout" width="100%">
<img src="docs/screenshots/showcase-ru.png" alt="The discovery screens in Russian" width="100%">

More in each language: [English](docs/marketing/en.md) · [עברית](docs/marketing/he.md) · [العربية](docs/marketing/ar.md) · [Русский](docs/marketing/ru.md)

A ready-made marketing website in English and Hebrew is in [`site/`](site/README.md): build it with `node site/build.mjs` and upload `site/dist` to any static host.

<sub>All 74 screens (37 in English, 37 in Hebrew) are in <a href="docs/screenshots">docs/screenshots</a>. Demo members are fictional and their pictures are illustrations.
Chat screenshots come from two real accounts chatting live in two browsers (<a href="e2e/chat.ts">e2e/chat.ts</a>); the safety screens from a reporter, a reported member and a moderator in three browsers (<a href="e2e/safety.ts">e2e/safety.ts</a>).</sub>

## Quick start

Requirements: Node.js ≥ 22.12, pnpm 10 (`corepack enable`), Docker with Compose v2, OpenSSL.

```bash
./install.sh                 # creates .env and storage credentials with strong random secrets
pnpm install
pnpm infra:up                # PostgreSQL (PostGIS + pgvector), Redis, SeaweedFS (S3)
docker compose -f infra/docker-compose.yml --env-file .env --profile full --profile dev up -d
                             # + ClamAV malware scanning, + Mailpit (catches sign-in emails)
pnpm dev                     # API on :4000 and worker (migrations run automatically)
pnpm --filter @nexaheart/e2e seed     # optional: fictional demo members around Tel Aviv
pnpm --filter @nexaheart/mobile web   # app in the browser on :8081
```

Open <http://localhost:8081>, sign in with any email, and click the link in Mailpit at <http://localhost:8025>.
For iOS/Android, run `pnpm --filter @nexaheart/mobile start` and open the project in a development build
([Expo docs](https://docs.expo.dev/develop/development-builds/introduction/)).

<details>
<summary>More commands</summary>

| Command                                         | What it does                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm check`                                    | Format check, lint, typecheck and unit tests                                                       |
| `pnpm --filter @nexaheart/api test:integration` | API tests against real Postgres, Redis and S3 (IDOR, chat, WebSocket…), on isolated test resources |
| `pnpm --filter @nexaheart/e2e screenshots`      | Walks the whole app in a browser, regenerates screenshots and runs an axe-core WCAG audit          |
| `pnpm --filter @nexaheart/e2e chat`             | Two browsers chat live: verifies real-time delivery and every chat safety feature                  |
| `pnpm --filter @nexaheart/e2e seed -- --reset`  | Recreates the fictional demo members (refuses to run against non-local databases)                  |
| `pnpm --filter @nexaheart/worker reembed`       | Re-computes every profile embedding (after switching the embedding model)                          |
| `./install.sh --force --reset-data`             | Regenerates secrets **and deletes all local data**                                                 |

</details>

## Architecture

```mermaid
flowchart LR
  app["Mobile & web app<br/>Expo / React Native"] -- HTTPS --> api["API<br/>Fastify + better-auth"]
  admin["Admin (planned)"] -.-> api
  api --> pg[("PostgreSQL<br/>PostGIS + pgvector")]
  api --> redis[("Redis")]
  api -- quarantine --> s3[("Object storage<br/>SeaweedFS / any S3")]
  redis -- jobs --> worker["Worker<br/>ClamAV scan, sharp,<br/>embeddings"]
  worker --> s3
  worker --> pg
  worker --> clam["ClamAV"]
  worker -. optional .-> ollama["Ollama<br/>local AI"]
```

| Path               | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `apps/api`         | Fastify API: auth, profiles, photos, discovery, matching, security   |
| `apps/worker`      | Background jobs: malware scanning, image processing, storage cleanup |
| `apps/mobile`      | Expo Router app for iOS, Android and web (Hebrew/English, RTL)       |
| `packages/shared`  | Zod schemas and types shared by server and clients                   |
| `packages/db`      | Drizzle schema and SQL migrations                                    |
| `packages/storage` | S3 helpers                                                           |
| `packages/ai`      | Embeddings (offline hashing, Ollama) and reciprocal scoring          |
| `infra/`           | Docker Compose and the Postgres image                                |
| `e2e/`             | Browser flow, screenshots and accessibility audit                    |

## AI, transparently

All AI features are optional, run on the community's own server by default, and are documented with their data use and eval results in [`docs/AI.md`](docs/AI.md). No attractiveness scoring, no face recognition, no AI decisions about accounts.

## Security and privacy

- Passwordless sign-in: magic-link tokens are single-use and stored hashed. Limits apply per IP and per inbox, and responses never reveal whether an email is registered.
- Every endpoint checks ownership on the server. Integration tests verify that one user cannot read, delete or reorder another user's photos.
- Uploads are type-checked by magic bytes, size-limited and held in a quarantine bucket until ClamAV has scanned them. They are then re-encoded with all EXIF/GPS metadata removed.
- Photos are served only through the API with an access check, never from public bucket URLs.
- Location is snapped to a ~1 km grid before it is stored, and distances are only returned as buckets, which limits trilateration attacks to cell precision.
- One visibility rule (mutual preferences, blocks, unmatches) gates discovery, profiles, photos and likes. Anything else returns "not found".
- Chat: only the two participants can read, write or load images. The WebSocket requires a session and an allowed Origin. Message text is never logged. Chats are encrypted in transit; end-to-end encryption is a planned opt-in.
- Limits on uploads, likes and messages count per user, not per IP, so people behind a shared mobile-network IP don't block each other.
- Strict security headers, CORS allowlist, request size limits, log redaction of tokens, emails and phone numbers, and no stack traces in responses.
- Gender and "interested in" can reveal sexual orientation, so they need their own explicit consent, asked before the profile is created. Withdrawing it hides the profile at once.
- "Download my data" gives a ZIP of everything the member provided (without other people's messages). Daily jobs enforce retention periods, and sessions don't store IP addresses or browser strings.
- No tracking, analytics or third-party requests. The privacy e2e test compares the browser's cookies and storage with the published list and fails on any request to another host. See [`docs/PRIVACY.md`](docs/PRIVACY.md).
- CI runs lint, typecheck, unit and integration tests, a dependency audit, CodeQL, Gitleaks and Docker builds. Actions are pinned to commit SHAs.

- Native sign-in hands the session over with a PKCE code exchange, never in a deep link, so another app that claims the URL scheme gets nothing usable.
- A release security review (three independent code reviews, 15 fixes, each with a test) is in [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md). CI also produces a CycloneDX SBOM.

Found a vulnerability? Please report it privately; see [SECURITY.md](SECURITY.md).

## Accessibility

NexaHeart targets **WCAG 2.1 AA** and the Israeli standard **IS 5568**. Every screen in the screenshot flow is scanned with
[axe-core](https://github.com/dequelabs/axe-core) and currently reports **0 violations**. Every control has a screen-reader label
and role, focus is visible for keyboard users, text scales up to 200%, and every swipe action has a button.
Further automated checks cover keyboard-only sign-in with visible focus, reflow at 320 px, 200% text, reduced motion and the document language and direction (`pnpm --dir e2e a11y`). Automated checks catch only part of the issues: manual testing with VoiceOver, TalkBack and keyboard is part of the [release checklist](docs/PRODUCTION_CHECKLIST.md).

## 💜 Sponsor NexaHeart

NexaHeart will stay free for everyone. Sponsorships fund what a safe dating platform needs and code alone can't provide:
independent **security audits**, **accessibility audits**, **legal review** of the privacy and consent templates, and a public demo.

| Tier                | Monthly    |
| ------------------- | ---------- |
| ☕ Supporter        | **$3**     |
| 💜 Friend           | **$10**    |
| 🛡️ Safety Champion  | **$25**    |
| 🏙️ Community Host   | **$100**   |
| 🏢 Organization     | **$500**   |
| 🌍 Founding Partner | **$1,500** |

One-time gifts: **$5**, **$25**, **$100**, **$500** or any amount.

<a href="https://github.com/sponsors/diamondrubinny"><img src="https://img.shields.io/badge/Sponsor_on_GitHub-%F0%9F%92%9C-ea4aaa?style=for-the-badge&logo=githubsponsors" alt="Sponsor NexaHeart on GitHub"></a>

What each tier includes, and what sponsorship will **never** buy (user data, moderation influence, ranking changes): [docs/SPONSORS.md](docs/SPONSORS.md).
Thank you to everyone in [SUPPORTERS.md](SUPPORTERS.md).

## Running a public instance

**Run your own community in three commands** on any server with Docker. Step-by-step guide with
questions and answers: [English](docs/INSTALL.md) · [עברית](docs/INSTALL.he.md) (short reference: [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)):

```bash
./install.sh --domain example.org          # secrets, production settings, one-time setup token
docker compose -f infra/docker-compose.yml --env-file .env --profile app --profile full up -d --build
# open https://admin.example.org, sign in, enter the setup token, set up 2FA, brand it
```

<img src="docs/screenshots/showcase-instance-en.png" alt="A community's own branded instance: welcome screen in light and dark mode, and the accessibility statement with the operator's contact" width="100%">

Moderation is part of running an instance: see [`docs/ADMIN.md`](docs/ADMIN.md) for granting staff roles, two-factor setup and serving the dashboard.

Whoever deploys an instance is the operator, and legal controller, of its users' data. Before going public you need, at minimum,
a reviewed privacy policy, terms of use, an accessibility statement and a moderation process.
Draft texts in English and Hebrew are in [`docs/legal/`](docs/legal/) and **require review by a qualified lawyer** for your jurisdiction.
[`docs/PRIVACY.md`](docs/PRIVACY.md) lists every piece of data, its purpose, suggested legal basis and retention period, plus
a DPIA screening and notes on GDPR and Israel's Privacy Protection Law (Amendment 13).
Go through [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) before launch; backups are covered by
`scripts/backup.sh` and the load test results are in [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Security, privacy and accessibility are requirements, not extras.

## License

[MIT](LICENSE) © 2026 Diamond Rubinny and contributors.

Created and maintained by **Diamond Rubinny** ([@diamondrubinny](https://github.com/diamondrubinny)).
