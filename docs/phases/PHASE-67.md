# Phase 67a: Discretion for hostile places: hidden distance, discreet notifications, an app lock and local help (v1.43)

> Status: ✅ 67a done (2026-10-31). 📘 = verify against official docs, ⚖️ = needs legal review.
> First part of the "hostile environment package" (`docs/research/market-gaps-2026-10.he.md`,
> item 6). 67b: countries at risk, the travel alert and partners in them.

## The gap (checked in the code)

- Distance is rounded to buckets ("less than 2 km"), but always shown: in a small town, or with
  someone setting up an ambush (Haifa, 2024), a bucket is still too much.
- Notifications carry the community's name as their title ("Rainbow Club: You have a new
  message"): on a lock screen, or a phone checked by family or at a border, that alone outs.
- Anyone holding an unlocked phone can open the app.
- There's no place for an operator to list local help: legal aid, emergency lines, LGBTQ+
  organisations.

## What changes

| Part                           | Change                                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hide my distance (member, off) | Others see no distance, no "near you" reason and no "visiting {city}" for me. Matching still uses it on the server.                                                                                                                                   |
| Discreet notifications (off)   | Every notification reads "New notification" / "You have something new", without the community's name or what happened.                                                                                                                                |
| App lock (this device)         | A 4–8 digit code asked when the app opens and after 5 minutes away. Stored only on this device as a salted hash; forgetting it means signing in again (which clears it). It can't protect a phone that's already compromised, and the screen says so. |
| Local help (admins)            | Dashboard → Branding: a plain-text list of local resources (up to 2000 characters). Members find it under Settings → "Help near you".                                                                                                                 |

## Security and privacy

- Two settings more, kept with the other preferences, in "Download my data".
- The app-lock code never leaves the device and isn't a server password ⚠️.
- Hiding distance changes only what others see.

## Tests

- Unit (worker): discreet notification text in 4 languages, no community name.
- Integration: hidden distance (no distance, no "nearby", no visiting city) for others, still in my
  own settings; discreet notifications stored; resources in `/v1/instance`, plain text only,
  admins only.
- App unit: the lock code hash (salt, compare, length).
- e2e (en, he): a member turns on discretion and sets a lock code; the app asks for it on reload; a
  wrong code is refused, the right one opens; another member sees no distance; "Help near you"
  shows what the admin wrote. axe 0. Screenshots.

## Done (67a)

- **Unit**: worker (1): discreet notifications in 4 languages (and a fallback) carry neither the
  community's name nor the kind of event; app (2): lock codes are 4–8 digits; only a salted hash is
  stored, a new salt each time; the right code opens, others don't; turning it off removes it.
- **Integration** (3, `discretion.test.ts`): hidden distance: no distance, no "visiting", no
  "nearby" reason on the profile and in Discover, while the other member's distance still shows;
  discreet notifications stored and in "Download my data"; local help: admins write it, everyone
  reads it in `/v1/instance`, markup refused, members refused, cleared with null.
- **e2e** `pnpm --dir e2e discretion` (en, he): the member turns both settings on; another member
  gets no distance; sets a lock code; after a reload only the lock screen shows; a wrong code is
  refused, the right one opens; "Help near you" shows the admin's list. axe 0. Screenshots
  `158-app-lock-settings`, `159-app-locked`, `160-help-near-you` (en, he).
- Docs: PRIVACY.md, CHANGELOG, README.

### Next (67b)

- Countries at risk (from ILGA's list, chosen by the operator): a travel alert and hiding the
  profile automatically there ⚖️; partners in those countries.
- A generic installed-app name and icon (phase 59 made the community logo the icon: the opposite
  of discreet) 📘; the browser tab title.
- A report reason for "refuses a call or a recent photo".
