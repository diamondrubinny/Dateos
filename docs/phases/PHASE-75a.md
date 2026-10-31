# Phase 75a: A suggested time and place, and an answer window for introductions (v1.61)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 75 (logistics), parts 3 and 4: once two
> people share when they're free, suggest a time and a place from what's already there; and a
> community-set window to answer an introduction (for example 24 hours). The interview, "ask about
> this profile" and the AI in a shared chat are 75b and later.

## What's here today (checked in the code)

- After a match each person can share when they're free (phase 20); both see only the overlap,
  and tapping a time opens the planner with it filled in.
- The planner (phase 12) lists the community's places; step-free first when it matters (25),
  kosher and closed-on-Shabbat tags (74b).
- An introduction (68a) gives 14 days to answer, fixed.

## Decisions

- **No AI here, on purpose.** The suggestion is plain logic over data both people already gave:
  the earliest shared time and a public place. Nothing is sent to a model, so nothing new to
  consent to, and the market's warning against AI-written dating holds (the research's 36-44%).
- **The place:** a calm public first-date place first (café, park, museum, then the rest),
  step-free when either person needs it (theirs only if they chose to show it), never one closed
  on Shabbat for a Saturday. Among equals, a stable choice per match, so both see the same.
- **Nothing is sent by itself:** it's a suggestion above the chat; "Plan it" opens the planner
  filled in, and the person still sends it.

## What changes

| Part          | Change                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A suggestion  | Above the chat, once there's an overlap: "Suggestion: Thursday evening at Café Puaa" and "Plan it".                             |
| The planner   | Opens with the place chosen too.                                                                                                |
| Answer window | Dashboard → Matchmakers: how long members have to answer an introduction (24 hours, 2 or 3 days, a week, 2 weeks, the default). |

## Tests

- Integration: no suggestion without an overlap; the earliest overlap; café before bar; step-free
  when needed; never closed on Shabbat on a Saturday; the same for both; only the two people. The
  window: saved by admins, used for new introductions and for the second side's own time.
- e2e (en, he): two people share times, the suggestion appears, "Plan it" fills the planner; the
  dashboard setting. axe 0. Screenshots.

## Done

- **Integration** (`dates.test.ts`, `introductions.test.ts`, "phase 75a"): no suggestion until both
  shared and overlap; the earliest overlap; a café before a bar; the same for both; step-free for
  my own need, and for the other's only when they show it; never a place closed on Shabbat for a
  Saturday; only the two people (404 for others). The window: only the listed values; a new
  introduction gets it, and the second side gets it again after the first one's yes.
- **e2e** `pnpm --dir e2e date-suggestion` (en, he): two people share times; the chat suggests the
  shared evening at the café; "Plan it" opens the planner with the place and the evening; the
  admin sets 24 hours in the dashboard. axe 0. Screenshots `192-date-suggestion`,
  `admin-18-introduction-window`.
- Docs: CHANGELOG, README. Nothing new is stored about members (PRIVACY.md unchanged).

### Not done here (75b and later)

- The onboarding interview, "ask about this profile", and the AI matchmaker in a shared chat.
