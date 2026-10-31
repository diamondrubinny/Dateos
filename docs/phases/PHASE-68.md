# Phase 68a: Community matchmakers, private introductions and credit (v1.45)

> Status: ✅ 68a done (2026-10-31). 📘 = verify against official docs, ⚖️ = needs legal review.
> First part of `docs/research/market-gaps-2026-10.he.md`, item 68 (matchmaking console, friends
> who suggest, a chaperone). 68b: a shareable "matchmaking résumé", friends who suggest a pair and
> a manual approval queue. 68c: a chaperone in the chat.

## The gap (checked in the code)

- The only "matchmaker" is the AI interview of phase 23, which suggests changes to one member's own
  filters. No person can introduce two members.
- Religious-Zionist, Haredi and Muslim communities, accessibility organisations (Inbar) and many
  35+ members rely on human matchmakers: 39% say there aren't enough, 86% want the woman to hear
  first, 70% support rewarding the matchmaker (Ba'im Betov survey, ynet).
- A fake "matchmaker" in Elad defrauded people with disabilities: a matchmaker the community names,
  publicly, is also a safety feature.

## What changes

| Part                                  | Change                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matchmakers (admins)                  | Dashboard → Matchmakers: an admin names a member as a community matchmaker (by email) and can take it back. Taking it back closes their open introductions. Audited.                                                                                                                          |
| A public badge                        | A matchmaker's profile shows "Community matchmaker since {date}", so members can check that someone who says so really is one.                                                                                                                                                                |
| Open to matchmakers (member, **off**) | Settings: only members who turn this on appear in the console. Nobody is listed without choosing to be.                                                                                                                                                                                       |
| The console (matchmakers, in the app) | Search the members open to matchmakers (name, age range, gender), see their profile as any member would, pick two, add a short note ("why I thought of you"), send. Only pairs who could see each other in Discover (every rule both ways, no block, no pass, not already matched). 20 a day. |
| Who hears first (admins)              | Dashboard → Branding: "both together" (default) or "women first": when one of the two is a woman, she gets it first and the other only if she says yes.                                                                                                                                       |
| The introduction (members)            | "Introductions" in the app: the matchmaker's name and note and the other person's profile. Yes or "no, thank you". Two yeses open a chat (a match). 14 days to answer.                                                                                                                        |
| Nobody learns about a no              | A no isn't shown to anyone: the other side never hears about it (if they had it, it stays "waiting" until it expires, then "didn't go ahead", as with no answer). The matchmaker sees only "didn't go ahead", never who said no.                                                              |
| Credit                                | After a match, either of the two can tell the matchmaker how it went: met, engaged, married. The matchmaker sees it on the introduction.                                                                                                                                                      |
| Report (admins)                       | Dashboard → Matchmakers: per matchmaker, introductions sent, matches, met, engaged, married, for a chosen period; CSV export with counts only, no member names ⚖️.                                                                                                                            |

Wording never presents being single as a problem (the research's interviewees found that framing
hurtful): "an introduction", "someone thought of you", not "help for singles".

## Security and privacy ⚖️

- Least privilege: a matchmaker sees only members who opted in, and only what any member sees on a
  profile (no email, no exact place, blurred photos stay blurred, the Match Note stays hidden).
- Every introduction, grant and revocation is in the audit log; the console's searches are audited
  too (`matchmaker.search`, without the query text), listed with staff access (phase 64).
- Being a matchmaker isn't staff: no dashboard access, no moderation tools.
- New data: who is a matchmaker (and since when, by whom); introductions (who, to whom, the note,
  answers, outcome), deleted with either member's account; answers aren't shown to the other side;
  in "Download my data" (for the matchmaker: introductions they sent, without the others' answers;
  for a member: introductions they received and their own answer).
- Introductions expire after 14 days; closed ones are deleted after a year (retention job).
- Federation: introductions stay inside one community (partners: 68b or later).

## Tests

- Integration: grant, badge, revoke (closes pending); console lists only opted-in members, not the
  matchmaker themself; refused for non-matchmakers; pair rules (blocked, passed, matched, not a
  candidate, not opted in, same pair twice); daily limit; both together → two yeses → match; women
  first → the man doesn't see it until she says yes; a no is never revealed (the other side still
  "waiting" until expiry, the matchmaker sees "didn't go ahead"); expiry; outcome credit only by
  the two, after a match; admin report and CSV; export; audit.
- e2e (en, he): an admin names a matchmaker; the matchmaker introduces two members; the woman
  hears first and says yes; the man says yes; a chat opens; one of them marks "we met"; the report
  counts it. axe 0. Screenshots.

## Order of work

1. Shared schemas; DB tables (`matchmakers`, `introductions`), preference, instance setting;
   migration.
2. API: service, member routes, matchmaker routes, admin routes, export, retention; tests.
3. Dashboard page; app screens (console, introductions inbox), settings toggle, badge; i18n ×4.
4. e2e, docs, PR, merge.

## Done (68a)

- **Unit** (shared, 3): women first only when exactly one of the two is a woman; the note is plain
  text between two different members; the CSV defuses formulas. Worker: the push says only "a new
  introduction", without names.
- **Integration** (7, `introductions.test.ts`): admins name matchmakers (only admins, unknown emails
  refused); the public badge; the console lists only members who opted in, never the matchmaker,
  filters by name and gender; a matchmaker sees a listed member's profile and photo, and someone
  outside their own dating rules only while that person is open to matchmakers; searches audited
  without the text. Together: both hear, one answer each, two yeses open a match; credit only by the
  two; the matchmaker sees states, never answers; the report and its period. Women first: he hears
  only after her yes. A no is never revealed (she sees "closed", the other side and the matchmaker
  "open" until it expires, then "didn't go ahead"; never introduced again). The matchmaker
  themself, other dating rules, not opted in, a pass, a block and an open introduction all get the
  same answer; 20 a day. Taking the role back closes open introductions and the badge goes
  (audited). Settings and "Download my data" (my own answer only).
- **e2e** `pnpm --dir e2e introductions` (en, he): an admin names a matchmaker and chooses "women
  first" in the dashboard; a member opts in from Settings; the matchmaker introduces the two from
  the console; she hears first and says yes; he says yes; a chat opens; he marks "we met"; the
  report counts it. axe 0. Screenshots `admin-38-matchmakers`, `162-matchmaker-console`,
  `163-introduction`, `164-introduction-matched` (en, he).
- Found on the way: in Hebrew, the dashboard's "take back" button had a name that didn't contain
  its visible text (axe, WCAG 2.5.3); fixed.
- Docs: PRIVACY.md, CHANGELOG, README.

### Next

- 68b: a shareable "matchmaking résumé" (a short-lived link, printable as PDF, with a watermark ⚖️).
- 68c: friends who suggest a pair; a manual approval queue for new profiles.
- 68d: a chaperone (wali) the member invites and can remove, with a visible notice to the other
  side ⚖️.
- Introductions between partner communities (federation).

---

# Phase 68b: A matchmaking résumé, shared by a short-lived link (v1.46)

> Status: ✅ done (2026-10-31).

## The gap

Parents, a family matchmaker or a rabbi often ask for a "résumé" (Shabbat.com and Haredi
matchmaking work this way). Today a member can only send screenshots, which carry everything,
never expire and can't be taken back.

## What changes

| Part              | Change                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| My résumé links   | Profile → "Matchmaking résumé": a link for one person ("Mom", "Rivka the matchmaker"), for 1, 3 or 7 days. The member picks what it shows: photo, about me, my answers (prompts), faith (only if filled in). Name, age, intention always. |
| Up to 5 at a time | Each shows how many times it was opened and when it ends; "Stop sharing" ends it at once.                                                                                                                                                 |
| The page          | No sign-in. Read-only, in the viewer's language, with a print button (save as PDF). A banner on the page and a watermark burned into the photo on the server: "Shared with {label} on {date} · ends {date}".                              |
| Never             | Email, place, distance, the Match Note, the private album, other photos. Not indexed (`noindex`), not cached, no referrer.                                                                                                                |
| An expired link   | Looks exactly like a wrong one ("This link isn't valid").                                                                                                                                                                                 |

## Security and privacy ⚖️

- The token (24 random bytes) is shown once and stored as a hash.
- Rate-limited by IP; a suspended or paused account's links stop working.
- ⚠️ Whoever has the link can pass it on or screenshot the page; the watermark names whom it was
  for, and the screen says so before sharing.
- Data: the label, what it shows, dates and an open count; deleted with the account, and 30 days
  after it ended; in "Download my data" (never the token).

## Tests

- Integration: create (label, days, fields), up to 5; the public card shows only the chosen fields,
  never email or place; the photo is a watermarked copy (not the original bytes), `no-store`,
  `noindex`; opens counted; stop sharing, expiry, a suspended owner and a wrong token look the
  same; export; only the owner manages links.
- e2e (en, he): a member creates a link for "Mom" with the photo and answers; the page (signed
  out) shows the banner, the card and the watermark; stop sharing; the page then says the link
  isn't valid. axe 0. Screenshots.

## Done (68b)

- **Integration** (5, `resume.test.ts`): a link for one person shows only the chosen sections,
  never email, place or the Match Note; `no-store`, `noindex`, `no-referrer`; opens counted for the
  member, the token never listed again; the photo is a watermarked copy, not the original bytes;
  stopping, expiry, a break and a suspension all look like a wrong link (and the photo too); up to
  5 at a time, plain-text labels, 1/3/7 days only; in "Download my data" without the token.
- **e2e** `pnpm --dir e2e resume` (en, he): the member makes a link for "Mom" with answers; signed
  out, the page shows the banner, the card and the photo with "אמא · dates" burned in; after
  stopping, "This link isn't valid". axe 0. Screenshots `165-resume-links`, `166-resume-page`.
- The API image installs `fonts-dejavu-core` (Hebrew, Arabic and Cyrillic) for the watermark.
- Docs: PRIVACY.md, CHANGELOG, README.

---

# Phase 68c: Friends who suggest a pair, and profiles approved by hand (v1.47)

> Status: ✅ done (2026-10-31).

## The gap

- Many couples meet through a friend who knows both (Shlish Gan Eden is built on it). In the app,
  only a named matchmaker (68a) can introduce two people.
- Small, close communities (religious, accessibility organisations, invitation-only groups) want a
  person to look at each new profile before others see it; today a new profile appears at once
  (signup modes only decide who may open an account).

## What changes

| Part                               | Change                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suggest a pair (any member)        | Matches → "Suggest two friends to each other": choose two people I'm friends with here (a friends-mode match, or my double-date pair) and write why. It works like a matchmaker's introduction: each answers privately, two yeses open a chat, a no is never revealed. Up to 3 a day. |
| Who may get one (member, on)       | Settings: "Friends may suggest someone to me" (on by default; it only ever comes from someone I'm already friends with here, and only for people I could meet in Discover anyway). Off: no friend suggestions.                                                                        |
| The introduction says who          | "{name}, your friend here, suggests you meet {other}", not a community matchmaker; no badge; never counted in the matchmakers' report.                                                                                                                                                |
| Approve new profiles (admins, off) | Dashboard → Branding: "A moderator approves each new profile". New profiles wait: nobody sees them, and they don't see Discover, until a moderator approves. Profiles made before it was turned on stay as they are.                                                                  |
| The queue (moderators)             | Dashboard → New profiles: photos, name, age, about me and answers; "Approve" or "Ask for changes" with a reason the member sees (photos, about me, answers, other) and an optional note. Audited.                                                                                     |
| The member                         | A banner: "Your profile is waiting for approval", or "Please change: {reason}" with the note; after editing, "Send again". Nobody else learns about it.                                                                                                                               |

## Security and privacy ⚖️

- A friend suggestion can only pair people the friend is connected with, both ways allowed by the
  usual dating rules; the friend never learns the answers, only "didn't go ahead".
- Moderators see only what any member would see on the profile (no email, no place), as they do
  for reports; every decision is audited and in "Download my data".
- New data: one setting; a profile's review state, reason and note.

## Tests

- Integration: friend suggestions only between my friends (friends-mode match, pair), never others;
  the receiver's setting; 3 a day; private answers and a match; labelled as a friend; not in the
  report. Approval: off by default; on, a new profile is hidden both ways until approved; existing
  ones aren't affected; ask for changes (reason, note), resubmit, approve; members can't use the
  queue; audited; export.
- e2e (en, he): an admin turns approval on; a new member sees "waiting"; a moderator asks for
  changes; the member sends again; approved; a friend suggests two friends. axe 0. Screenshots.

## Done (68c)

- **Integration** (3, `friend-suggestions.test.ts`): a friend suggests two friends (a friends-mode
  match or a double-date pair), each answers privately, two yeses open a match, the friend sees
  only states; labelled `friend`, with the friend's name and no matchmaker badge, no console and
  never in the matchmakers' report; refused for non-friends and for members who turned suggestions
  off; 3 a day. Approval: off by default; on, a new profile is hidden both ways (Discover, its
  profile page) while existing ones aren't; the queue shows no email or place, members can't use
  it; "ask for a change" with reason and note, resend once, approve; audited; in "Download my
  data".
- **e2e** `pnpm --dir e2e friend-suggestions` (en, he): an admin turns approval on; a new member
  sees "waiting"; a moderator asks for a change; the member sees the reason and note and sends it
  again; approved. A member suggests two friends; one sees it came from a friend. axe 0.
  Screenshots `167-review-pending`, `admin-39-reviews`, `168-suggest-friends`,
  `169-friend-suggestion` (en, he).
- Matchmakers' consoles and introductions never include profiles that are waiting.
- Docs: PRIVACY.md, CHANGELOG, README.
