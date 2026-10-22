# Phase 18: Take a break, incognito and travel mode (v0.5)

> Status: 📝 plan, waiting for approval.
> 📘 = verify against official docs, ⚖️ = needs legal review.

Three features from the plan's v0.2–v0.5 list that aren't built yet. They're all free for everyone,
like every other feature. Each one gives the member more control over **who sees them and when**.

## 18a. Take a break (pause my profile)

**User story:** "I'm on holiday / busy / talking to someone I like. I want to stop being shown
without losing my matches or deleting the account."

- In settings: "Take a break" with a duration: 24 hours, 3 days, a week, or until I turn it back
  on.
- While paused:
  - New people don't see you in Discover, Daily Picks or Likes You.
  - Your own Discover and Picks show a calm screen instead of profiles: "You're taking a break" with
    "Come back now".
  - **Existing matches and chats continue** (recommended). Chat and calls work as usual, so a break
    doesn't ghost anyone.
  - Likes people sent before the break stay waiting for you.
- At the end of the chosen time the profile becomes visible again by itself. The worker sends a
  content-free push: "Your profile is visible again".
- Technically:
  - A new nullable column `paused_until timestamptz`; "until I turn it back on" is stored as
    `'infinity'`.
  - The existing status `paused` stays reserved for a withdrawn sensitive-data consent. The two are
    kept apart so that resuming never overrides a missing consent.
  - Visibility: `paused_until IS NULL OR paused_until <= now()` joins the single visibility query
    (`candidateSql`). No extra code path, so no place can forget it.

## 18b. Incognito

**User story:** "I want to choose who sees me, for example because a colleague or a relative might
also be here."

- In settings: "Incognito: only people I like can see me".
- While on:
  - You can browse as usual.
  - Other people see you only after you've liked them.
  - People who already matched with you aren't affected.
- Technically: a `profiles.incognito boolean` column. One condition in the visibility query:
  `NOT c.incognito OR c already liked the viewer`. Because the query is the single source of truth,
  this also covers profile views, photo access and interactions (IDOR safe by design).
- Privacy:
  - Nobody is told that someone is incognito: no badge and no hint.
  - A person who was liked by an incognito member sees the profile as usual.
- ⚖️ Incognito is not a security promise. A screenshot after a like can still leak a profile; the
  app's help text says so.

## 18c. Travel mode

**User story:** "Next week I'm in Haifa / Berlin. I want to meet people there before I arrive."

- In settings: "Travel mode": pick a city and a duration (up to 14 days).
- While on:
  - Distances and Discover are computed from the city's centre instead of your area.
  - Your profile shows an honest badge "Visiting Haifa", so people know you aren't local.
- At the end, your own area comes back by itself. Your real location is kept as it was and is never
  replaced.
- **City list** (recommended): a list bundled with the app, made from the **GeoNames** cities with
  more than 100,000 inhabitants (about 4,500 cities, ~250 KB, licensed CC BY 4.0).
  - Search runs on our own server. No external geocoding service gets what members type.
  - Names in English and in the local name; Hebrew, Arabic and Russian names where GeoNames has them
    📘.
  - ⚖️ CC BY 4.0 requires attribution: added to the about screen and to `NOTICE` (third-party data).
  - Alternative: a list of cities the community's admins choose in the dashboard (like venues).
    It's smaller, but every community would have to build it.
- Privacy:
  - The city centre is a public point. Your real ~1 km grid cell is never shown.
  - The distance to a traveller is shown as "in Haifa", not as kilometres from the city centre.
  - Travel location and dates are in "Download my data" and are deleted when travel ends + 30 days.

## Security and privacy

| Threat                                                                           | Control                                                                                                                           |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A paused / incognito member still reachable through a profile URL or a photo URL | All access goes through `candidateSql` (one source of truth); IDOR tests cover pause, incognito and travel                        |
| Inferring that someone is incognito ("I can't find X")                           | No badge or hint; the same "not found" answer as for any profile you can't see                                                    |
| Travel mode used to locate someone precisely                                     | Only city centres; distance shown as the city name                                                                                |
| Abuse: jumping cities to scrape                                                  | At most 3 travel changes per day (rate limit) and at most 14 days per trip                                                        |
| Data retention                                                                   | `paused_until`, `incognito`, the travel city and dates are in the data export; travel data is deleted 30 days after the trip ends |

## Accessibility

- Every switch is a real `switch` with a label and a hint; duration choices are radio buttons.
- City search is a combobox that works with a keyboard and a screen reader (results announced).
- Banners ("You're taking a break", "Travel mode: Haifa until 5 Nov") have role `status`.
- Tested in 4 languages, RTL, 200% text and 320px width, as in earlier phases.

## Files (expected)

- `packages/db`: migration (`paused_until`, `incognito`, `travel_*` columns), a `cities` table and
  its seed.
- `packages/shared`: schemas and texts for the three settings.
- `apps/api`: `/v1/me/pause`, `/v1/me/incognito`, `/v1/me/travel`, `/v1/places?q=`; the changes to
  `candidateSql`; tests.
- `apps/worker`: end of pause (push) and end of travel; retention.
- `apps/mobile`: three settings sections, Discover banners, the "Visiting" badge, city search.
- `e2e/visibility.ts`: two to three accounts, screenshots in 4 languages.
- Docs: PRIVACY.md (new data), the privacy policies ⚖️, README, CHANGELOG, NOTICE (GeoNames).

## Tests

- Integration:
  - A paused member is hidden from discovery, picks and likes-you, and its profile and photo URLs
    are unreachable, while chats with existing matches continue.
  - Pause ends by itself; it doesn't override a withdrawn consent.
  - An incognito member is visible only to people they liked.
  - Travel moves the distance computation to the city and ends by itself.
  - Rate limits; IDOR.
- e2e: the three settings in 4 languages, the banners and the badge; axe 0 violations.

## Decisions (to approve)

1. During a break, chats and calls with existing matches continue. **Recommended: yes.**
2. Incognito is free for everyone, like everything else. **Recommended: yes.**
3. Travel cities come from a list bundled from GeoNames (CC BY 4.0). **Recommended: yes**; the
   alternative is an admin-defined list.
4. Travellers show a "Visiting {city}" badge. **Recommended: yes** (honest, prevents disappointment).
5. Order: 18a → 18b → 18c, one PR each.
