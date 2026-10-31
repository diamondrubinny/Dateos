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

---

# Phase 67b: A discreet installed app, countries at risk and a sign of fake profiles (v1.44)

> Status: ✅ done (2026-10-31).

## The gap (checked in the code)

- Phase 59 made the community's logo the installed app's icon and its name the app's name: on a
  home screen checked by family or at a border, that's the opposite of discreet. Browser tabs and
  notification icons show them too.
- Travel mode (phase 18c) moves a member to a city anywhere, including a country where being on a
  dating app, or LGBTQ+, is dangerous; nothing warns them or hides them there. Tinder's Traveler
  Alert does both.
- The research's report reason "refuses a video call or a recent photo" (a common sign of a fake
  profile or a setup) isn't mentioned anywhere.

## What changes

| Part                              | Change                                                                                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discreet app (admins, off)        | Dashboard → Branding: a neutral name (e.g. "Notes") for the installed app. Then the manifest, the browser tab and notification titles use it, and every icon is a plain grey one made on the server, never the logo. 📘 Installed apps keep their old icon until reinstalled on some systems. |
| Countries at risk (admins, empty) | Dashboard → Branding: the countries (ISO codes) the community considers dangerous, chosen by the operator (ILGA's yearly report is a good start) ⚖️ 📘. No default list.                                                                                                                      |
| Travel to one of them             | Before saving, the app warns; the profile is hidden from new people for the trip (as "take a break"), on by default, and back when the trip ends or is ended early.                                                                                                                           |
| Report: fake profile              | The report form explains that refusing a short video call or a recent photo is a common sign.                                                                                                                                                                                                 |

## Tests

- Unit: the manifest with a discreet name (name, icons, no logo, neutral colour).
- Integration: the discreet name in `/v1/instance`, the manifest and the icon route (a grey PNG, not
  the logo); risk countries saved (ISO codes only); travel to one hides the profile from new people
  until the trip ends (or ends early), unless the member chose not to; travel elsewhere doesn't.
- e2e (en, he): an admin sets a discreet name and a risk country; the tab title and the manifest
  use it; a member chooses a city there and sees the warning; the profile is hidden. axe 0.

## Done (67b)

- **Unit** (shared, 1): a discreet manifest has the neutral name, no description, a neutral colour
  and plain icons, never the logo or the community's name.
- **Integration** (4, `hostile.test.ts`): the discreet name in `/v1/instance` and the manifest, the
  icon route makes a grey 192×192 PNG (not a redirect to the heart), markup refused, cleared;
  countries: ISO codes only, each once, admins only; a trip to one hides the member (as a break
  ending with the trip) and ending it early ends the hiding; elsewhere nothing changes; the member
  can choose not to hide; a break they chose stays after the trip.
- **e2e** `pnpm --dir e2e hostile` (en, he): the dashboard shows the name and the countries; the
  manifest and the browser tab use the neutral name and plain icon; choosing Haifa (marked for the
  test) warns, hiding is on by default, and the member is hidden for the trip. axe 0. Screenshots
  `admin-37-discreet`, `161-travel-risk` (en, he).
- Notifications' title is the discreet name too (worker).
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- Partner communities in countries at risk: partners don't declare a country; an operator who
  considers one dangerous can end the partnership.
- 📘 Native builds (alternate app icons) and installed PWAs that keep their old icon until
  reinstalled.
