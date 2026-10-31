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

- 68b: a shareable "matchmaking résumé" (a short-lived link or a PDF, with a watermark ⚖️), friends
  who suggest a pair (phase 22 takes), a manual approval queue for new profiles.
- 68c: a chaperone (wali) the member invites and can remove, with a visible notice to the other
  side ⚖️.
- Introductions between partner communities (federation).
