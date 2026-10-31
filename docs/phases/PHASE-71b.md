# Phase 71b: Places by group, events for a group, and weekly events (v1.52)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 71 (Events 2.0), parts 2 and 7: places by
> gender with a waiting list for each, and events for a group (women only, an age range, a
> religious stream), and repeating events. Organizers in Israel filter by age and observance
> (Ladies-First, Duvdevanim); CitySwoon balances places by gender.

## What's here today (checked in the code)

- An event has one capacity and one waiting list (phase 16); anyone can join any event.
- Staff publish events one by one (phase 14); nothing repeats.
- The faith module (62b) keeps a member's stream only with the `religion` consent, and only when
  the community turned the module on.

## What changes

| Part                               | Change                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who it's for (staff, optional)     | Genders (e.g. women only), an age range, and with the faith module on, streams. Members see it on the event ("For women, 25–35"); people outside it see the event but can't take a place, and are told why in plain words.                                   |
| Places by gender (staff, optional) | e.g. 12 women and 12 men: each group has its own places and its own waiting list, in order. A freed place goes to the next person waiting in the same group. The total capacity is the sum. Members see how many places are left for their group, never who. |
| Repeat weekly (staff)              | "Repeat weekly" makes 1 to 12 copies, a week apart, with the same place, details, audience and places; each has its own people going.                                                                                                                        |
| Changing it later                  | Staff can change who it's for and the places; people already going keep their place.                                                                                                                                                                         |

## Security and privacy ⚖️

- The age comes from the birth date and the gender from the profile, both already required. The
  stream is used only if the member gave the `religion` consent and has one; without it, a
  stream-only event is not open to them, and nothing is stored about the attempt.
- A place records the group it was taken in (the gender at the time), so a later profile change
  doesn't move anyone. Deleted with the RSVPs.
- Events for one gender or stream may be restricted by local anti-discrimination law in some
  places (e.g. Israel's Prohibition of Discrimination in Products, Services and Entry law); the
  operator decides ⚖️. The dashboard says so next to the setting.

## Tests

- Integration: audience by gender, age and stream (with and without the consent); places by
  gender with separate counts, full per group, a waiting list per group, a freed place promoted
  within its group; the event view per viewer (places left for my group, eligible or why not);
  repeating weekly (1–12, copies independent); staff only; validation (pools sum, genders known).
- e2e (en, he): staff set a women-and-men event with 2+2 places in the dashboard; a member who
  doesn't fit sees why; a member joins the waiting list of their full group. axe 0. Screenshots.

## Done

- **Integration** (4, `event-groups.test.ts`): audience by gender and age (`notForYou`, refused
  places and waiting lists); streams refused without the faith module, then matched only against a
  stream given with the consent; validation (ages, genders). Places by gender: "full" per group, a
  waiting list per group with its own order, a gender without places refused, a freed place
  promoted within its group, counts in the staff list and never names, the group in the export.
  Places by gender added later: people going keep their place in their group; back to one list.
  Repeat weekly: 1–12 independent copies with the same audience and places; 13 refused.
- **e2e** `pnpm --dir e2e event-groups` (en, he): the admin sets 2 women + 2 men, ages 25–40, in the
  dashboard and repeats it weekly; a woman joins the women's waiting list while men still have
  places; a nonbinary member sees why there's no place for them. axe 0. Screenshots
  `admin-10-event-groups`, `180-event-groups`, `181-not-for-you` (en, he).
- Age ranges are isolated left to right, so they read 25–40 in Hebrew and Arabic too.
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- Recurring rules beyond weekly (monthly, a set day).
- Tables, community organizers and live support (71c).
