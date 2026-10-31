# Phase 74b: Kosher and "closed on Shabbat" places (v1.60)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 74 (Shabbat and holidays), the second part:
> "kosher" and "closed on Shabbat" tags for places in the date planner. The first part (the mode
> itself) was 74a.

## What's here today (checked in the code)

- Places (phase 12) have a category, an area, a note and "step-free" (phase 25), which is copied
  into each date plan so later edits don't change what two people agreed on, shown on dates and
  events, and used as a filter in the planner.
- Nothing says whether a place is kosher or open on Shabbat.

## What changes

| Part               | Change                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Dashboard → Places | Two more checkboxes: "Kosher (with a valid kashrut certificate)" and "Closed on Shabbat and holidays". Badges in the list. |
| The planner        | The tags on each place, and "Kosher places only" when any place is kosher.                                                 |
| Dates and events   | The tags on the date card and on events, copied into the plan like step-free.                                              |

## Notes ⚖️

- "Kosher" is the community's own statement about a business: the dashboard asks for it only with
  a valid certificate, and says that the staff is responsible for keeping it current ⚖️.
- No member data: these are facts about places.

## Tests

- Integration: the tags saved by staff (members can't), shown in the planner and copied into a
  date plan (an edit later doesn't change the plan); on events.
- e2e (en, he): staff tag a place in the dashboard; the planner shows the tags and filters to kosher
  places; the date card shows them. axe 0. Screenshots.

## Done

- **Integration** (`dates.test.ts`, "phase 74b"): admins set the tags (members can't; a bad value
  is refused); members see them; a date proposed at the place keeps them even after the place
  loses its certificate, while new dates see the change. The full suite passed with the tags on
  every place that events and dates show.
- **e2e** `pnpm --dir e2e kosher-places` (en, he): the admin marks a place kosher and closed on
  Shabbat in the dashboard; the planner shows both tags, "Kosher places only" leaves the other
  place out; the date card in the chat shows the tags. axe 0. Screenshots `admin-17-kosher-venue`,
  `191-date-kosher`.
- Docs: CHANGELOG, README. No personal data, so nothing for PRIVACY.md.

### Not done here

- Warning when a date is proposed on Shabbat at a place closed on Shabbat, or to someone in
  Shabbat mode (it would reveal their mode to the proposer unless they chose to show it).
