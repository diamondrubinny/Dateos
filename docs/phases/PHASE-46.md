# Phase 46: Suggest another time (v1.19)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

A date idea (phase 12) could only be accepted or declined. "Not this time" when the real answer
is "yes, but Saturday" ends the conversation about it; people then retype the whole idea, and the
chat holds two cards that seem unrelated.

## What

- On a date idea you received: **Accept**, **Suggest another time**, **Not this time**.
- "Suggest another time" opens the planner with the **same place** (no place list) and the time
  choice; the original time is shown. Optional short note (harm-checked, as before).
- Sending it **declines the idea, marked as countered** ("Another time suggested" on the card) and
  sends the new idea from you, in **one transaction**: the chat never has two open ideas, and a
  concurrent accept or withdrawal wins once (409, "This date idea has already changed").
- The other person can accept it, decline it, or suggest another time in turn.
- Rules as for any idea: 30 minutes to 60 days ahead, the place must still be on the community's
  list, daily idea limit, same-retry idempotency (`clientId`). The same time as before is refused.
- Fix: closed cards (declined, cancelled, countered) were drawn at 75 % opacity, which axe flagged
  as low contrast (WCAG 1.4.3). They now keep full colour and get a dashed border.

## API

`POST /v1/dates/:id/counter` `{ startsAt, clientId, note? }` → 201 the new card (receiver only,
60/hour with the other date actions). `date_plans.countered` (migration `0050`); the card has
`countered`, and "Download my data" includes it.

## Privacy

No new personal data: a flag on an existing row, deleted with the chat as before.

## Tests

- Integration `dates-counter.test.ts` (5): the full exchange and accepting the answer; only the
  receiver, only while open; a different valid time, venue not accepted, idempotent retry; a place
  taken off the list; a hurtful note changes nothing. `dates.test.ts` still passes.
- e2e `pnpm --dir e2e date-counter` (en, he): no place choice, same time refused on the device, the
  database rows, accepting the answer; axe 0. `pnpm --dir e2e dates` re-run (4 languages, axe 0).
