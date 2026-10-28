# Changelog

All notable changes to NexaHeart. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **Account activity** (Settings → Security): your sign-ins (with a coarse device name), devices
  signed out and data downloads of the last 90 days. Only you see it; staff don't, and it's
  deleted with the account.
- **Mute and archive a chat**: no message notifications from a muted chat (calls still ring);
  archived chats move to their own section until a new message brings them back. Private.
- **Unsend a message** (within 15 minutes): both people see "Message unsent". For safety, the
  content is kept 30 days only for moderation: a report from the other person adds it as evidence
  automatically. Then it's deleted.
- **Replies**: quote a message of the same chat; hidden and unsent quotes stay hidden.
- **Read receipts, your choice**: turn "Seen" off in Settings (then you don't see others' either).
- **Undo a pass**: right after passing on someone in Discover, Undo brings them back (the last
  pass, for 10 minutes; likes can't be undone).
- **Reactions to messages**: ❤️ 😂 😮 😢 👍 🔥, one each per message, seen live by the other person,
  with a picker that works with a keyboard and a screen reader. Not on hidden (harmful) messages.
- **Your devices** (Settings → Security): see where you're signed in (a coarse name such as
  "Chrome · Windows" or "NexaHeart app on Android", never an IP address), and sign out of one
  device or everywhere else. Open live connections of a signed-out device close within a minute.
- **Created by Diamond Rubinny**: the credit under "Powered by NexaHeart · Open source" in the app
  and the dashboard, `poweredBy.author` in `GET /v1/instance`, `CITATION.cff`, and author details in
  every `package.json`; `check-credit` keeps them in place.

### Security

- **Push tokens are bound to the device**: knowing someone's push token is no longer enough to move
  it to another account and silence their notifications (closes an accepted risk from phase 7).

- **Partner communities: replacing the signing key** from the dashboard, without ending
  partnerships: partners are told with the old key and a proof from the new one; one that's down
  is told within a week.
- **Partner communities: safety**: members can report someone from a partner community; the report,
  with the chat as evidence, goes to that person's own community's moderators, and only "reviewed"
  comes back. Admins can suspend and resume a partnership (nothing crosses, nothing is deleted).
  Deletions, unmatches and reports that can't reach a partner are retried for up to 7 days.
- **Partner communities: chat**: matches from partner communities can now write to each other
  (text). Each community keeps its own member's side; "Are you sure?" and each community's own
  filters (hurtful messages hidden, scam warnings) apply; live updates and content-free
  notifications; the conversation is deleted on both sides with the match.
- **Partner communities: discovery and matching**: members can join (off by default, an explicit
  consent) to see and be seen by members of partner communities who joined too, matched both ways
  by gender, interest, age and intention. Partners know each member only by a random code name;
  photos come through the member's own server. A mutual like is a match on both servers; blocks,
  unmatching, leaving, deleting the account and ending the partnership reach the other side.
  Chat across communities comes next.
- **Partner communities (foundation)**: admins can connect their community with another NexaHeart
  community they trust (Dashboard → Partners), after both confirm a data-sharing agreement. Every
  request between the servers is signed, dated and can't be replayed. Off by default
  (`FEDERATION=on`); no member data crosses yet. Discovery across communities comes next.
- **Event updates and questions**: organizers post updates to an event, and people going or
  waiting get a content-free notification. Members going can ask the organizers privately; staff see
  questions without who asked, and only the asker sees the answer. Who else is going is still never
  shown.
- **Voice transcripts**: "Show text" under every voice message and voice prompt, made by an open
  speech model (Whisper) in the worker on your own server, only when someone who may play the clip
  asks. Automatic for members who shared "deaf or hard of hearing"; a speaker can choose "voice
  only". `TRANSCRIPTS=off` turns it off.
- **Easy mode and display settings**: larger text, higher contrast, reduced motion, and an easy
  mode with three tabs, bigger buttons, fewer menus and a plain explanation under Like and Pass.
  Offered on the welcome page; kept on the device only.
- **Accessibility needs** (optional, with their own consent): step-free places come first in the
  date planner, captions start by themselves in calls, and a short line can be shown on the profile.
  Never used for ranking or as a filter by others, never sent to an AI model.
- **Integrations in the dashboard**: connect email, sign-in with Google and Apple, a CAPTCHA
  (Cloudflare Turnstile or hCaptcha), the AI model, video (LiveKit), push, error monitoring (Sentry
  or GlitchTip), privacy-friendly analytics (Plausible, Umami, Matomo, only after consent), team
  alerts (Slack, Discord, Telegram, Teams) and signed webhooks, each with a test button. Secrets are
  encrypted and write-only; the server's environment variables always win. See
  [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- **Matchmaker**: a few quick questions (and, if a model is available, your own words) become
  suggested changes to your settings. You tick the ones you want; nothing is stored and nothing
  changes without you. Gender, orientation and religion are never touched.
- **Video speed dating**: a new event type. People going wait in a lobby; short end-to-end encrypted
  video rounds pair those who may see each other under everyone's own settings. After each round you
  answer privately; only a mutual yes makes a match.
- **Check-in at the venue**: the dashboard shows a QR code that changes every 30 seconds; scanning it
  fills in the code. An opt-in badge, "Checked in at an event", says only yes or no.
- **Friends' takes**: send a friend a one-time link; they write a few words about you without an
  account. You approve each one, and up to 3 appear on your profile with their first name.
- **Double date**: pair up with a friend through a link and see other pairs only when all four of you
  could see each other. When both pairs like each other, a group chat of four opens. Anyone leaving,
  or a block, closes it for everyone.
- **Friends mode**: a separate deck for friendship with its own ages and genders, never mixed with
  dating. Friend matches are labelled "Friends" in Matches.
- **Copied photos**: every profile photo gets a perceptual hash. A copy of another member's photo
  (even resized or re-compressed) opens an automatic case for the moderators, and a photo of a banned
  account can't be used on a new one. Flat images get no hash, so they never match.
- **Hide me from my contacts**: paste addresses (web) or pick from your contacts (app). They're hashed
  on the device; the server keeps only which members matched and hides you from each other, silently.
- **Passkeys**: add one in Settings and sign in with your fingerprint, face or screen lock (web).
- **Who can join**: open (the default), invite codes (also personal invites from verified members),
  or a waitlist moderators approve, set in the dashboard's new Joining page.
- **Screenshot protection** in the native app on chats, profiles and calls (Android blocks
  screenshots, iOS screen recording). The web can't, and Settings says so.
- **When we're both free**: in a chat, mark the mornings, afternoons and evenings you're free in the
  next two weeks. Only the times you're **both** free are shown, never the other person's list;
  tapping one opens the date planner with that day and time filled in. The times are deleted when
  the chat closes and once they've passed.
- **Did you meet?**: two hours after an agreed date, the card asks each person privately whether you
  met and whether you'd like to meet again. Nobody sees the other's answer; only when you both say
  yes does the card show "You both want to meet again". "Something felt wrong?" opens a private
  report.
- **Met in person badge**: off by default; once turned on, the profile shows "Met in person" after
  both people of a date confirmed meeting. A yes/no only, with no dates or counts.
- **Your turn**: with six people waiting for your reply, Discover asks you to answer them before
  liking someone new (passing still works).
- **About me**: up to 10 interests from 40, children, smoking, drinking and height, all optional,
  shown on the profile as chips (shared interests are marked and nudge the ranking). Religious
  observance can be added with its own explicit consent; it's never used for ranking, and
  withdrawing the consent deletes it.
- **Dealbreakers**: smoking, children, height and religious observance filters that work both ways;
  people who didn't answer are always shown.
- **Opening question**: a question your matches see on your profile and in a new chat.
- **Voice prompt**: answer one prompt out loud (up to 30 seconds), through the same malware scan and
  re-encoding as voice messages, played only to people who can see your profile.
- **Travel mode**: going somewhere? Pick a city (search in any of the four languages) and up to
  two weeks: Discover shows people around that city, and your profile honestly says "Visiting Haifa"
  instead of a distance. Your own area is untouched. Cities come from a bundled GeoNames list (CC BY
  4.0) searched on the community's own server; at most 3 trips a day.
- **Incognito**: "only people I like can see me". Browse as usual; others see your profile only
  after you like them, matches aren't affected, and nobody is told you're incognito.
- **Take a break**: in Settings, stop being shown to new people for 24 hours, 3 days, a week or until
  you come back. Discover, Daily Picks and Likes You show a calm "You're taking a break" card instead;
  matches, chats and calls carry on, so nobody is ghosted, and likes sent to you wait for your
  return. The profile comes back by itself (with a content-free notification).

### Changed

- Build-time dependencies: patched esbuild (drizzle-kit's loader) and uuid (Expo's iOS project
  tooling) through overrides; `pnpm audit --prod` has no open advisories beyond the two reviewed ones.
- Right-to-left text in the chat and call screens now aligns to the right on the web (it followed
  the page direction only inside the standard screen layout).
- **License: AGPL-3.0-or-later with a credit that must stay** (see [NOTICE](NOTICE)). Every copy,
  including forks and rebranded communities, shows "Powered by NexaHeart · Open source" (linking to
  nexaheart.com) on the app's welcome, sign-in, settings and legal screens, in the dashboard, on the
  website and in every email; operators keep their own name and logo next to it. A modified version
  run for others must link to its own source (`SOURCE_CODE_URL`). Every source file carries the
  license header, and `pnpm lint` fails without the credit. Versions published before 22 October 2026
  stay MIT.

### Changed

- **New name: NexaHeart** (formerly Dateos, a name already used by a company in the UK). Packages are
  `@nexaheart/*`; the app's link scheme, cookies, storage keys and defaults for new installations use
  `nexaheart`. Nothing was released under the old name, so no migration is needed.
- A real app icon: a heart with three connected points, on the brand violet (it was Expo's
  placeholder).

### Added

- **Private calls**: video dates are end-to-end encrypted. The two devices agree on the key
  (X25519), so even the community's own server can't see or hear a call; a 4-emoji safety code lets
  both people check that nobody is in the middle. Nothing is sent before the key exists.
- **Live captions in calls**: turn on "Show captions" to read what the other person says. Their own
  device makes the captions, on the device only (never a cloud service), only while you ask and
  their microphone is on; the text travels inside the encrypted call and is never stored.
- **Waiting lists for community events**: a full event offers "Join the waiting list"; members see
  their place in line (never who else waits); when someone can't go after all or an admin adds places,
  the next people in line are moved to "going" and notified. The dashboard shows how many are waiting.
- **Video dates**: matches can have a video or voice-only call in the app, through the community's own
  LiveKit server (`docker compose --profile video`, `./install.sh --domain … --video`). Off until an
  admin turns it on (dashboard → Branding → Video dates, with a maximum length). Calls unlock with the
  chat, the other person always chooses to join, cameras are off on join, there is no recording or
  screen sharing, and reporting, blocking or a suspension hangs up at once. Limits against unwanted
  calls; a line in the chat ("Video call · 14 min"); audio and video are never stored.
- **Community events**: the team publishes meetups at the community's places (dashboard → Events,
  with capacity); members see upcoming events and how many are going (never who), say they're going,
  get a reminder the day before and a notice if it's cancelled. Who's going is deleted 30 days after
  the event.
- **Date planner**: in a chat, propose a date at a public place from a list your community's admins
  curate (no maps service, no coordinates), pick a day and time and add a note; the other person
  accepts or says "not this time", live. An accepted date opens a safety check-in already filled in.
  Admins manage places in the dashboard ("Places"); every change is audited.

### Fixed

- Link, number, date and time fields in the dashboard had no styling (the Branding page's donation
  link included).
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
