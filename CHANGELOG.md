# Changelog

All notable changes to NexaHeart. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- **New name: NexaHeart** (formerly Dateos, a name already used by a company in the UK). Packages are
  `@nexaheart/*`; the app's link scheme, cookies, storage keys and defaults for new installations use
  `nexaheart`. Nothing was released under the old name, so no migration is needed.
- A real app icon: a heart with three connected points, on the brand violet (it was Expo's
  placeholder).

### Added

- **Date planner**: in a chat, propose a date at a public place from a list your community's admins
  curate (no maps service, no coordinates), pick a day and time and add a note; the other person
  accepts or says "not this time", live. An accepted date opens a safety check-in already filled in.
  Admins manage places in the dashboard ("Places"); every change is audited.

### Fixed

- Arabic and Russian were missing from the native apps' language list (iOS and Android).
- The chat header cut off its last action in Arabic and Russian; it now wraps.

## 0.2.0 (2026-10-22)

### Added

- **Installation guide** in English and Hebrew (`docs/INSTALL.md`, `docs/INSTALL.he.md`): steps with
  checks, troubleshooting, and questions and answers; also on the marketing site.
- **Marketing site** in English and Hebrew (`site/`), with real screenshots, light and dark, no
  cookies or analytics.
- **Safety check-in**: share where you'll be and when you expect to be done; a trusted contact is
  emailed (in your language, with only what you wrote) if you don't tap "I'm OK" in time, or at once
  with **SOS**. A push reminder at check-in time. Deleted 7 days after it ends.
- **Anti-ghosting**: "Close kindly" ends a conversation with a polite message (three ready-made in each
  language, or your own) that the other person sees on a card for 7 days; chats waiting more than 3 days
  for your reply are marked.

### Fixed

- Long option labels overflowed the screen in any language; chips now wrap, and long choices are shown
  one per line.
- The Arabic "Profile" tab label was cut off.
- Gender-neutral wording in the new Arabic, Hebrew and Russian texts; the SOS label reads correctly
  right to left.

## 0.1.0 (2026-10-21): first release candidate

The first complete version: a free, open-source dating app (iOS, Android, web) that any community can
run on its own server.

### Features

- **Accounts**: passwordless email links (web and native, with a PKCE hand-off on native), versioned
  consents including a separate explicit consent for sensitive data, account deletion, "Download my
  data".
- **Profiles**: photos (malware-scanned, re-encoded, metadata removed), prompts, preferences,
  approximate location (~1 km), profile editing, Profile Coach.
- **Matching**: reciprocal ranking with reasons ("why you might click"), Daily Picks, Likes You, liking a
  photo or prompt with a comment, unmatch and block.
- **Chat**: real-time messages, read receipts, typing, icebreakers, photos and voice messages after a
  3+3 unlock, "Are you sure?", hidden offensive messages and scam warnings, push notifications without
  content.
- **Safety**: reports with copied evidence, human photo verification (no face recognition), suspension,
  bans by keyed email hash, moderation dashboard with mandatory TOTP and an audit log.
- **AI (optional, local first)**: semantic matching, icebreakers and bio ideas with Ollama or any
  OpenAI-compatible endpoint; external providers only with consent; evals and a transparency page.
- **Your own instance**: setup token claim, branding wizard (name, logo, colour with contrast check,
  languages), HTTPS with Caddy, `install.sh`, backups.
- **Privacy**: data inventory, retention jobs, optional inactivity deletion, no tracking, a published
  storage inventory checked against the real browser; draft legal texts in English and Hebrew.
- **Accessibility**: WCAG 2.1 AA target, Hebrew right-to-left, keyboard and screen-reader support,
  0 axe-core violations, extra checks for focus, reflow, text size and reduced motion.

### Security fixes from the release review

See [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md): native sign-in session exposure (high),
WebSocket after sign-out, verified badge after a photo swap, reusable setup token, and eleven lower ones.

### Known limitations

- Native sign-in, sharing and push need testing on real devices before store submission.
- Voice messages have no transcript; no video dates yet.
- Legal texts are drafts that need review; an external penetration test and an accessibility audit are
  recommended before a public launch.
