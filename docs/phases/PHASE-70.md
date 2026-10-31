# Phase 70: Mutual accountability and "My visibility" (v1.50)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 70.

## What's already here (checked in the code)

| Item in the research                      | Status                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| "Close kindly" and a nudge in stuck chats | ✅ Phase 9: "Waiting for your reply" after 3 days, with reply or close kindly; the other side sees the closing card. |
| A window for new members in the ranking   | ✅ Phase 2: ×1.1 for the first week, and the "new here" reason.                                                      |
| "Active recently" from `lastActiveDays`   | ✅ Phase 2: the "active recently" reason when active in the last day.                                                |
| Focus mode ("your turn")                  | ✅ Phase 20: with 6 people waiting, Discover asks to answer first.                                                   |
| "We met" feedback affecting picks         | ❌ Not used in the ranking.                                                                                          |
| Less exposure for people who don't answer | ❌                                                                                                                   |
| A "my visibility" screen                  | Partly: phase 44's preview lists a break, incognito, no photo, no location.                                          |

## What changes

| Part                               | Change                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fewer new people while others wait | While **5 or more** people the member **matched with** have been waiting **3+ days** for their reply, new people see them a bit less (×0.6 in the ranking, never hidden). Counted only on matches (the member liked them too), never on incoming likes, so popular members who don't answer every like aren't affected. Lifted **at once** when they reply or close kindly: no penalty period.             |
| Said up front, privately           | The "My visibility" screen says it plainly, with the number waiting and what lifts it; never shown to anyone else.                                                                                                                                                                                                                                                                                         |
| Showing up counts a little         | Someone who met a match in person (both confirmed, in the last 180 days) gets ×1.05 in the ranking. Not a reason shown to others; the badge stays opt-in.                                                                                                                                                                                                                                                  |
| "My visibility" (every member)     | Profile → "My visibility": one place that says whether new people can find me and, if not fully, why and what to do: a break (until when), incognito, no photo, no location, waiting for approval (68c), the like limit reached (65), verified members only (65), the people waiting for my reply, or "You're visible". The opposite of a shadow ban: nothing limits visibility without being listed here. |

## Security and privacy ⚖️

- No new data: computed from matches, messages and confirmed dates already stored.
- The reduced exposure is an automated adjustment of the ranking, self-lifted, explained to the
  member before it matters; whether it needs a formal statement of reasons (DSA Art. 17) is a
  question for review ⚖️. It never removes anyone from Discover and never applies to likes the
  member didn't return.

## Tests

- Unit (ai): the ranking with people waiting (5 → ×0.6, 4 → ×1) and with showing up (×1.05).
- Integration: the visibility screen for each state (break with an end, incognito, no photo, waiting
  for approval, the like limit, verified only, people waiting); waiting counts only matches, only
  3+ days, only when the other person wrote last; replying or closing kindly lifts it; the ranking
  puts the member lower while it holds.
- e2e (en, he): a member with people waiting opens "My visibility", sees why, replies, and sees
  "You're visible". axe 0. Screenshots.

## Done

- **Unit** (`packages/ai`, "accountability (phase 70)"): 5 people waiting → ×0.6, 4 → ×1; met a
  match in person → ×1.05.
- **Integration** (4, `accountability.test.ts`): "My visibility" lists each limit (a break with its
  end, incognito, waiting for approval, the like limit with the number, verified only as "fewer",
  no photo, no area); 4 waiting over 3 days and a fresh one don't count, the fifth does, and an
  otherwise identical member ranks ahead in someone else's Discover; one reply lifts it; likes he
  never returned never count; closing kindly lifts it.
- **e2e** `pnpm --dir e2e accountability` (en, he): five matches waiting four days, Profile → My
  visibility says so with the number and "Open my chats"; one reply → "You're visible". axe 0.
  Screenshots `175-my-visibility`, `176-visible` (en, he).
- Fixed on the way: the approval banner (68c) showed twice in Discover while on a break or with
  nobody to show.
- Docs: MATCHING.md (accountability), PRIVACY.md, CHANGELOG, README.

### Not done here

- A notice when the reduced exposure starts (the screen says it; a push could too).
- Using the "we met" feedback (phase 20) beyond the small ×1.05.
