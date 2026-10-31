# Phase 74a: Shabbat and holiday mode (v1.59)

> Status: ✅ done (2026-10-31). 📘 = verify against official sources, ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 74: automatic quiet from candle lighting to
> havdalah, and on holidays, by an approximate location and the Hebrew calendar; messages wait and
> arrive after Shabbat; matches see "Keeping Shabbat". No competitor has it. Kosher and
> "closed on Shabbat" tags for places come in 74b.

## What's here today (checked in the code)

- Quiet hours (phase 39): pushes in a daily window are dropped (calls and safety check-ins
  still come). Nothing knows about Shabbat or holidays.
- Members' location is kept only as a ~1 km grid cell (phase 2): enough for sunset times.
- The Hebrew date is shown on events (71c), from the device's own Hebrew calendar (ICU).
- Nobody's online status or "last seen" is shown to others, so there's nothing to hide there.

## Decisions

- **Times, written here, no new dependency.** Sunset and nightfall from the standard NOAA solar
  equations (accurate to about a minute), holidays from ICU's Hebrew calendar (`Intl`, built into
  Node and browsers). The common open-source library (Hebcal) is GPL-2.0, which may not combine
  with this AGPL-3.0 project, and we need only a small part of it. 📘 Times are checked against
  published tables in the tests.
- **Customs as settings:** candle lighting 18 minutes before sunset by default (20, 22, 30 or 40,
  as in Jerusalem); Shabbat and holidays end at nightfall, when the sun is 8.5° below the horizon
  (a common custom); a second day of holidays outside Israel, by choice. 📘
- **Days of rest:** every Shabbat; Rosh Hashanah (2 days), Yom Kippur, the first and last days of
  Sukkot (Shemini Atzeret) and Pesach, and Shavuot, plus the second day where chosen. Adjacent
  days merge into one rest.
- **Keeping Shabbat is religious information ⚖️:** it's turned on only with its own consent
  (`shabbat`, GDPR Art. 9(2)(a)), separate from the faith profile's. Withdrawing it turns the mode
  off and deletes the settings. Matches see "Keeping Shabbat" only if the member chooses, and
  only while it's Shabbat or a holiday for them. For the same reason a community can't turn it on
  for its members by default; it can only point to it.

## What changes

| Part          | Change                                                                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The setting   | Settings → Notifications → "Shabbat and holidays": on with the consent; candle lighting minutes; a second day of holidays; "Tell my matches I'm keeping Shabbat". It shows the next rest, in local time ("Friday 16:31 to Saturday 17:35"). Needs the approximate location (the app already has it). |
| Quiet         | From candle lighting to nightfall, no pushes at all: messages, matches, calls, events. Safety check-ins still come (a life matters more).                                                                                                                                                            |
| After Shabbat | One notification after nightfall ("Welcome back: new things came in over Shabbat or the holiday"), only if something came in.                                                                                                                                                                        |
| In chat       | During the member's rest, matches see "Keeping Shabbat: back after Shabbat" in the chat, if the member chose it.                                                                                                                                                                                     |

## Tests

- Unit (shared): sunset and nightfall within 2 minutes of published times for Jerusalem, Tel Aviv
  and New York (summer and winter) 📘; Shabbat window; Rosh Hashanah 2 days; Yom Tov next to
  Shabbat merges; the second day only where chosen; polar days give no window.
- Integration: needs the consent; the settings and the next window; withdrawing the consent turns
  it off; pushes held in the window (check-ins not), then one summary after; the chat note only
  while resting and only when chosen; export.
- e2e (en, he): the settings screen (consent, next times), and a match sees the note. axe 0.
  Screenshots.

## Done

- **Unit** (`packages/shared/test/zmanim.test.ts`): sunset within 2 minutes of published times in
  Jerusalem and New York, summer and winter 📘; nightfall 30 to 56 minutes later; no sunset in a
  polar summer (no rest is computed there); Shabbat, Rosh Hashanah (two days), Yom Kippur, Pesach
  and its second day only where chosen, Shavuot; a rest from candle lighting to nightfall; Rosh
  Hashanah on Saturday and Sunday is one rest from Friday; Shavuot on Friday followed by its second
  day on Shabbat ends on Saturday night; whether it's a rest now.
- **Integration** (`shabbat.test.ts`): the mode needs its own consent (the faith profile's isn't
  enough); invalid minutes and unknown time zones refused; the next rest in Tel Aviv on the right
  Friday and Saturday; in the export; withdrawing the consent turns it off and forgets the
  settings; audited. Matches see it only while resting and only when chosen. Messages and calls
  are held during the rest and check-ins aren't; one notification after nightfall, only once and
  only when something came in; turned off, nothing is held.
- **e2e** `pnpm --dir e2e shabbat` (en, he): Noa turns it on with the consent in Settings, sees the
  times, tells her matches, picks 40 minutes; Dan's chat shows "keeping Shabbat" while it's
  Shabbat in Tel Aviv (it was, on the day it ran) and nothing otherwise. axe 0. Screenshots
  `189-shabbat`, `190-chat-resting`.
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here (74b and later)

- Kosher and "closed on Shabbat" tags for places in the date planner (74b).
- A community default: it would mean storing religious information without each member's
  consent ⚖️, so a community can only point members to the setting.
- Other customs (Rabbeinu Tam's nightfall, fixed minutes after sunset), and minor fast days.
