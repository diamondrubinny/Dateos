# Phase 71d: Tables by a short questionnaire, and the place revealed a day before (v1.54)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 71 (Events 2.0), parts 4 and 5: tables of
> about six people matched by a short questionnaire, and the place and "who's at your table"
> revealed a day before (Timeleft). Community organizers (part 6) are a separate phase (71e): they
> change who may create events.

## What's here today (checked in the code)

- An event shows its place from the start; people going sit wherever they like.
- Members never see who else is going (phase 14), and that stays the default.

## What changes

| Part                                     | Change                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reveal the place later (staff, optional) | "Reveal the place N hours before" (1–72): until then members see the area only ("Tel Aviv"); the name, address and note appear at that time. Staff always see it.                                                                                                                             |
| Tables (staff, optional)                 | "Tables of N" (4–10). People going may join a table by answering three quick questions: the evening's pace (calm or lively), conversation (deep or light) and drinks (with or without alcohol, or either). Joining is optional and is the consent to share their first name with their table. |
| Who's at my table                        | At the reveal time (or the start, when the place isn't hidden) tables are set once, balancing genders and grouping similar answers; each person sees their table number and the first names at it. Someone joining later goes to the smallest table. Nobody else sees any table.              |
| Leaving                                  | Leaving the event leaves the table; the others see one name fewer.                                                                                                                                                                                                                            |

## Security and privacy ⚖️

- The answers are about the evening, not the person, and stay with the RSVP (deleted 30 days after
  the event). Only first names are shown, only to the same table, only to people who joined a
  table themselves. Staff see the number of tables and people per table, never names.

## Tests

- Integration: the place hidden until the reveal (members), always shown (staff); joining a table
  only for people going, answers validated, changeable before the tables are set; tables set once
  at the reveal, sizes differing by at most one, genders balanced; my table's first names only;
  someone late goes to the smallest table; leaving removes them; staff counts only.
- e2e (en, he): before the reveal the event shows the area only and "Join a table"; after it, the
  place and my table's names. axe 0. Screenshots.

## Done

- **Unit** (`apps/api/test/tables.test.ts`): the seating: sizes within one, each gender spread
  evenly, similar answers together, the same result whatever the order.
- **Integration** (2, `event-tables.test.ts`): the place hidden until the reveal (members), shown to
  staff; joining only for people going, answers validated and changeable; tables set at the reveal
  (two tables of three, genders mixed); my table's first names only; someone late goes to the
  smallest table; staff see counts, never names; leaving the event leaves the table; the export;
  without a reveal, tables at the start; leaving a table; no tables without a size; validation.
- **e2e** `pnpm --dir e2e event-tables` (en, he): the area only and joining with three answers;
  after the reveal, the place and my table's first names. axe 0. Screenshots
  `183-event-table-join`, `184-event-table`.
- Fixed on the way: four older Hebrew strings had a maqaf before a number.
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- A push when the place and tables are revealed.
- Community organizers (71e).
