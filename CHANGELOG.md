# Changelog

All notable changes to Dateos. Versions follow [Semantic Versioning](https://semver.org/).

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
