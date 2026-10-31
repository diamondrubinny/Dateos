# Changelog

All notable changes to NexaHeart. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **Events for a group**: staff can set who an event is for (genders, an age range, and with the
  faith module, streams). Everyone sees it; people outside it are told why and can't take a place.
- **Places by gender**: e.g. 12 women and 12 men, each with its own places and waiting list; a
  freed place goes to the next person in the same group.
- **Repeat weekly**: 1 to 12 copies of an event, a week apart, from the dashboard.

- **Meet again**: for 3 days after an in-person event, people who checked in can join Meet again
  and privately choose whom they'd like to see again; only a mutual choice becomes a match and a
  chat. Nobody learns a one-sided choice.
- **Places for people who come**: at events where check-in was used, missing an event without
  leaving it gets a private note; two misses in 30 days pause new places and waiting lists for 14
  days. Members can excuse one miss a month, no questions asked; staff see nothing.

- **My visibility**: Profile → My visibility says whether new people can find you and, if not
  fully, every reason and what lifts it (a break, incognito, no photo, no area, waiting for
  approval, the daily like limit, verified members only). Nothing limits a member's visibility
  without being listed there.
- **Mutual accountability**: while 5 or more of your matches have waited over 3 days for your
  reply, new people see you a bit less; one reply or a kind close lifts it at once. Likes you
  didn't return never count. Meeting a match in person counts a little in your favour.

### Fixed

- A video-call test waited a fixed 50 ms for hang-up listeners; it now waits for them.
- Leaving an event after it ended is refused (it could erase a check-in).
- The approval banner showed twice in Discover while on a break or with nobody to show.

- **A live check**: with a provider the community chooses (`LIVENESS_URL`/`LIVENESS_SECRET`),
  members can verify their photos in a minute: a live face compared with their first photo. Only
  the result comes back; no selfie or face data is kept. The moderator's selfie check stays.
- **Ask to verify**: in a chat with someone not verified, a member can kindly ask them to verify,
  once; they see a gentle card with a way to do it.

- **A chaperone (wali)**: a member invites someone they trust to read their dating chats from that
  day on, text only and never writing. Everyone they chat with sees a notice naming the chaperone
  and that their own messages are read too. The member sees when the chaperone last looked and can
  remove them at any moment; the chaperone can step down.

- **Friends who suggest a pair**: suggest two of your friends here (friends-mode matches or your
  double-date partner) to each other. They answer privately, as with a community matchmaker; you
  only see whether it went ahead. Members can turn friend suggestions off.
- **New profiles approved by hand**: a community can have a moderator approve each new profile
  before others see it (Dashboard → New profiles), or ask for a change with a reason and a note
  the member sees and answers by sending it again.

- **Matchmaking résumé**: a read-only page about you for one person (a parent, a matchmaker), by a
  link that works for a day, three days or a week and can be ended any time. You choose what it
  shows (photo, about me, answers, faith); the page and a watermark burned into the photo say whom
  it was shared with and until when. Printable as PDF; never indexed or cached.

- **Community matchmakers**: admins name members as community matchmakers (shown on their profile,
  so members can check who really is one). A matchmaker introduces two members who turned on
  "Open to matchmakers"; each answers privately, two yeses open a chat, and nobody is told about a
  no. Communities can choose "women first". Either of the two can tell the matchmaker how it went
  (met, engaged, married); the dashboard counts it per matchmaker, with a CSV.

- **A discreet app and countries at risk**: communities can give the installed app a neutral name
  (with plain grey icons, never the logo, also in the browser tab and notifications) and list
  countries they consider dangerous; travelling to one warns the member and hides them from new
  people for the trip (on by default). The fake-profile report explains a common sign (refusing a
  short video call or a recent photo).

- **Discretion**: hide my distance (no distance, "near you" or "visiting" for others), discreet
  notifications ("New notification", without the community's name or what happened), an app lock
  code kept only on the device (asked on opening and after 5 minutes away), and "Help near you",
  local help the community lists in the dashboard.

- **Private album**: up to 6 photos never on the profile, shared from a chat with one match for one
  look (a minute), 10 minutes from the first look, or without a limit; stopping or ending the match
  closes it at once. The server checks the share on every photo request.

- **Match Note**: a short note only matches see (a disability or access need, identity, children,
  how you live), on the profile card once you match; never strangers, the preview or partner
  communities. Also: the hurtful-words filter now catches English plurals ("idiots").

- **Blurred profile photos**: members can blur their photos for everyone and show them to one
  match at a time from the chat (and take that back); communities can show photos only after a
  match. The blur is made on the server, never by hiding the real photo in the app, and such
  photos are never cached; partner communities get them blurred too.

- **Who can reach me**: members can limit new likes a day (10, 25 or 50; once reached, new people
  stop seeing them until it drops) and accept first messages from verified members only (others
  see why and how to verify). Threats to share images unless someone pays are recognised in four
  languages: the receiver sees an urgent banner (don't pay, keep the chat, report now) and "Report"
  opens with Threat chosen. More local scam phrasing (cheques, matchmaker and registration fees,
  parcels at customs) in Hebrew, Arabic and Russian.

- **Compliance kit in the dashboard**: a transparency report for any period (counts only, CSV and
  JSON); a security incident log that shows when the authority should be told and can't be
  deleted; a security statement, a no-paid-features pledge and a risk assessment in English and
  Hebrew, filled from the community's settings; and an audit log filter for staff access to member
  data.

- **Age checks through the community's provider**: an admin can require every member to confirm
  they're over 18 with an age-check provider set up on the server. The provider sends back only the
  result, signed (HMAC) and single-use; the community never sees an ID or a photo. Under 18
  suspends the account.

- **Presets and who may join**: one click sets a community up as general, LGBTQ+, faith and
  marriage, 50+ or friendship only; admins can set an age range, limit joining to some genders and
  ask new members to confirm a declaration. Onboarding shows the rules and explains a refusal
  plainly (no suspension); members already in keep their place.

- **Marriage, relationship history and a faith module**: "marriage" as an intention (matched
  closest to long-term); relationship history in "About me"; and, where the community turns it on,
  faith, stream (e.g. national-religious, Haredi, traditional, Sunni, Catholic) and observance
  (Shabbat, kashrut, halal, prayer…) with faith and stream filters, with the religion consent.
  Admins choose the intentions the community offers.

- **Gender identity and pronouns, in the community's own vocabulary**: beside the four genders used
  for matching (unchanged), members can add how they describe themselves (a longer list, or their
  own words where the community allows it) and how to address them (she/her, he/him, they/them; in
  Hebrew, Arabic and Russian, feminine, masculine or neutral address). Shown to matches only
  unless they choose everyone; never used for matching or sent to partner communities. Admins
  choose what the community offers in Branding.

- **The reasons for a decision, and a way to appeal it**: a warning, suspension or ban now comes
  with an explanation written for the member and its ground (the community's rules or the law),
  shown in the app with the date and whether an automatic check found it, never who reported or
  the moderator's note. The member can appeal once within 6 months, also while suspended; staff
  decide in the dashboard's new **Appeals** page (not whoever took the decision, unless the only
  admin); reversing lifts a suspension or withdraws a warning. Emails without content both ways.

- **Notifications in the web app** (Web Push): new matches, messages, calls, safety check-ins and
  event updates, with the same rules as the phone app (your choices, quiet hours, muted chats) and
  no names or message text; encrypted to your browser, so its push service can't read them. A tap
  opens the chat. The install command makes the server's keys (and adds them to existing servers).

- **The community's logo as the installed app's icon**: once a logo is uploaded in Branding, the
  home-screen icon is made from it (kept whole on a white square, inside Android's safe zone for
  round icons); without one, NexaHeart's icon as before.

- **An installable web app**: "Install app" / "Add to Home Screen" with the community's name, icon
  and colour (the manifest follows Branding, in the community's language direction), and the app
  opens even while the server restarts or the connection is away, then carries on by itself. Its
  service worker keeps only the app's own code, never anything from the API; listed on the Privacy
  & cookies page.

- **Choose when an update installs**: now, or at a time you choose up to 7 days ahead (suggested:
  03:00 in your time zone), withdrawable until it starts; and **Previous updates** in System →
  Updates: what was installed, what didn't install and why, what was withdrawn.

- **Short outages without losing anyone**: while the server restarts or installs an update, a
  member opening the app sees "Can't reach the community right now" (not signed out) instead of
  the welcome page, and the app carries on by itself when it's back; inside the app, one line at
  the top instead of errors, and the open screens reload when it's back. The dashboard the same.
  Caddy now answers `503 SERVER_RESTARTING` with `Retry-After` while the API is down.

- **Update emails to the admins**: an email when a new version is available (what was added or
  fixed, at most once a day) and when an approved update finishes (installed, or why not), in
  Hebrew and English. `UPDATE_EMAILS=off` turns them off.

- **Updates from GitHub, approved in the dashboard**: admins see what was added or fixed since their
  version (System → Updates, and a notice on every page) and approve installing it; the server
  backs up, updates, checks it started, and goes back to the previous version if it didn't.
- **Admins are emailed when backups stop**: daily, once a day at most, in Hebrew and English, with
  what to check on the server; also to the team's alert channel when it's set up.
- **System page in the dashboard** (admins): whether every part of the server works, and when the
  last backup finished, with an alert when none is recorded or it's over 36 hours old.
- **One-command install over SSH** (`scripts/bootstrap.sh`): installs Docker if needed, downloads,
  configures (including SMTP), starts, waits until ready, sets up encrypted daily backups and prints
  the setup token. Running it again updates the instance.
- **Suggest another time** on a date idea you received: the same place at a time that suits you,
  in one step; the original idea shows "Another time suggested".
- **Running late?** An active safety check-in can be moved 30 minutes, 1 hour or 2 hours later, up
  to 3 times and within 12 hours of the start, before the trusted contact is emailed.
- **See my profile as others do** (profile tab): the exact card others get, what keeps it out of
  new people's decks right now (break, incognito, no approved photo, no area) with a fix for each,
  and how many photos are still being checked.
- **Sign in again before the irreversible**: deleting the account or changing its email needs a
  sign-in from the last 15 minutes; the app offers a fresh sign-in link to the account's address.
- **Photo descriptions reach partner communities** (optional field; older partners ignore it).
- **Add to calendar** for an accepted date and an event you're going to: a calendar file made on
  the device. A date's entry is discreet ("Meeting at {place}", no name, no app name).
- **Change your email address** (Settings → Security): a one-time link to the new address (30
  minutes, opened while signed in), a heads-up without a link to the current one, other devices
  signed out on confirmation. Same answer for any address, so the form can't reveal who has an
  account.
- **Photo descriptions** (accessibility): describe each photo in your own words (up to 150
  characters); people using a screen reader hear it on your profile card. In "Download my data".
- **Quiet hours** (Settings → Notifications): no notifications between two times you choose, in
  your device's time zone (23:00–08:00 to start, moved in half hours). Calls and safety check-in
  alerts always come through.
- **Pinned chats**: pin up to 3 chats to the top of Matches (private; pinning unarchives, archiving
  unpins).
- **Message drafts**: what you typed and didn't send stays in the chat and shows as "Draft: …" in
  Matches. On this device only, never sent to the server; removed on sign-out.
- **"Your report was reviewed"**: after a moderator decides, the member who reported sees whether
  action was taken (never which action) or that no rule was found broken, with a reminder that
  blocking is always available. Shown for 30 days, until dismissed.
- **Dashboard → Overview** (moderators and admins): the open queue by priority and category, the
  oldest open report, the last 7 days (reports from members and automatic ones by reason, resolved,
  median time to resolve, new accounts, suspensions) and verifications waiting. Counts only.
- **A gentle start for new accounts**: an account under a day old can start 10 conversations a day
  (replies are never limited), so a fresh spam account can't message everyone at once.
- **Blocked people** (Settings → Security): who you blocked, by name only, with Unblock after a
  confirmation. They're never told; a match the block ended stays ended.
- **Profile strength** on the Profile tab: what's left to add (photos, bio, prompts, interests,
  photo verification, voice prompt), each a link to where it's done. Computed on the device.
- **Anti-bot and fake-profile checks** (phase 34): the same message to 5+ chats in a day, scam
  signals from an account under a day old in 3+ chats, and profile text copied from another
  account each open an automatic report for a moderator (with the reason; nothing is decided
  automatically). Liking faster than a person reads (40+ likes in 10 minutes) asks to slow down.
- **Verified profiles only**: a Preferences switch to see only people whose photos were verified.
- **Notifications your way**: turn new-match, new-message and community-event notifications on
  or off. Calls and safety check-in alerts are always on.
- **Maybe later**: put a profile aside in Discover without deciding; it waits, privately, under
  Likes (up to 30). Liking or passing clears it.
- **An email when a new kind of device signs in** (no link in it, at most 3 a day; can be turned
  off in Settings → Security).
- **Search in a chat**: text messages, newest first; never unsent or hidden messages.
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

- **Request logs keep the path only**: the query string (which carried the one-time sign-in token
  of a magic link) is no longer logged.
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

### Changed

- **The README, the marketing pages (4 languages) and the marketing site tell the current story**:
  the features since phase 25, new screenshots of them (built from the e2e runs), the one-command
  install over SSH, and the repository's current address.

### Fixed

- **One-command install, tested end to end**: it now checks free disk space before building (a full
  disk failed halfway with an unclear error) and removes old images after an update.
- **Dashboard form fields** had faint edges (1.45:1, WCAG 1.4.11): a `--control` colour brings them
  to 4.26:1 in light and dark mode. Every dashboard page is now swept by axe in both modes.
- **Daily backups failed on installed servers**: `backup.sh`/`restore.sh` ran `.env` as shell code and
  stopped at the unquoted tagline (exit 127) before writing anything. They now read only the two
  values they need; `.env.example` quotes the tagline.
- **Brand colour contrast in dark mode**: text on secondary buttons was below WCAG AA (4.02:1 with the
  default colour). The brand palette now reaches 4.5:1 on every background in both modes.
- **Keyboard focus ring** is darker in light mode (5:1) and drawn 2 px away from the control; the
  edges of text fields and choice chips reach 3:1.
- **Profile preview** can be scrolled from the keyboard (an "Edit my profile" button at the end).
- **Answered date ideas were hard to read**: closed date cards were faded to 75 % opacity, below
  the WCAG AA contrast ratio. They now keep full colour, with a dashed border.
- Hebrew icebreakers used slash forms (מוותר/ת, את/ה); rephrased so no gender is assumed.
- Double dates could miss pairs once more than 300 people were nearby; pair discovery now checks
  the newest undecided pairs directly.
- "Your turn" (focus mode) counted 0 people waiting as soon as anyone, anywhere, had unmatched: a
  query helper's alias shadowed the caller's. Each helper now uses its own aliases; regression test.
- Link, number, date and time fields in the dashboard had no styling (the Branding page's donation
  link included).
- Arabic and Russian were missing from the native apps' language list (iOS and Android).
- The chat header cut off its last action in Arabic and Russian; it now wraps.
- Emails to the admins (backup alerts) linked to `/#/system` without an address when
  `PUBLIC_ADMIN_URL` was empty, as after the install command; they now use `https://admin.<domain>`.
- Dashboard, System → Updates: the server's message about a failed update kept its full stop on
  the wrong side in Hebrew; it now has its own direction.
- Dashboard, System → Updates: the section has its own spacing, and the Hebrew "all changes" link
  reads correctly next to "GitHub".

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
