# Phase 13: New name, NexaHeart

> Status: ✅ done (2026-10-22). 📘 = verify against official docs, ⚖️ = needs legal review.

The project was called "Dateos". A company with that name exists in the UK, and "Date…" names are
crowded in dating (hard to register and to find). The new name is **NexaHeart**: "Nexa" for nexus and
next (connecting systems, the next generation), "Heart" for dating.

Checked on 2026-10-22: `nexaheart.com`, `nexaheart.app` and `nexaheart.io` were unregistered (RDAP),
and a web search found no company or app with that name. This is not a trademark search: before
launch, search the Israeli, UK, US and EU registers ⚖️.

## What changes

| Area                      | Before                                                                                 | After                               |
| ------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| Name in UI and docs       | Dateos                                                                                 | NexaHeart                           |
| Packages                  | `@dateos/*`                                                                            | `@nexaheart/*`                      |
| App                       | scheme `dateos://`, `org.dateos.app`                                                   | `nexaheart://`, `org.nexaheart.app` |
| Cookies, storage          | `dateos.session_token`, `dateos.locale`, …                                             | `nexaheart.…`                       |
| Redis keys, channels      | `dateos:…`                                                                             | `nexaheart:…`                       |
| Defaults for new installs | database and user `dateos`, buckets `dateos-…`, Docker project `dateos`, `/opt/dateos` | `nexaheart` everywhere              |
| Screenshots, site         | show "Dateos"                                                                          | regenerated                         |

No migration is needed: nothing was released (the work is in an unmerged pull request), so there are
no existing installations or signed-in members. Existing `.env` files keep working because database,
user and bucket names come from `.env`.

## What stays for now

Links to the GitHub repository keep the current address (`github.com/diamondrubinny/Dateos`). After
the owner renames the repository, GitHub redirects the old address, so the links work before and
after; they can then be updated in one step.

## Checks

Format, lint, typecheck, unit and integration tests; every e2e suite in four languages with axe (they
also regenerate the screenshots); no "dateos" left outside the repository links and the history in
this file.

## Results

| Check          | Result                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename         | 195 files; nothing named "dateos" is left except the repository links (on purpose, see above) and this file                                                                                                                  |
| Lockfile       | Regenerated offline (`pnpm install --offline`); no old package names left                                                                                                                                                    |
| Tests          | Unit (158), integration **126**, typecheck, lint, format: all pass                                                                                                                                                           |
| E2E            | screenshots, chat, privacy, safety, voice, coach (with the local model), a11y, check-in, date planner and the fresh-instance test behind Caddy over HTTPS: all pass, axe-core **0** violations; every screenshot regenerated |
| Icon           | `apps/mobile/scripts/make-icons.mjs` generates the app, Android adaptive, monochrome, splash and web icons from one design                                                                                                   |
| Marketing page | Rebuilt and republished at the same address, with the new mark in the header                                                                                                                                                 |

## Found and fixed along the way

1. The app icon was still Expo's placeholder (a blue chevron with guide lines).
2. The native apps listed only Hebrew and English as supported languages (`expo-localization`),
   although the app has Arabic and Russian since phase 8.
3. Three texts from early phases were never updated: the profile tab said Discovery and Daily Picks
   "arrive in the next release", and the match screen and a matched profile said "Chat arrives in the
   next release". They now point to what exists.
4. Running the fresh-instance test showed the dev object storage had run out of volume slots because of
   old test buckets (a dev-only leftover; the compose file already reserves 64 slots for installs).

## For the repository owner

- Rename the GitHub repository to `NexaHeart` (Settings → General → Repository name). GitHub redirects
  the old address, so existing links and clones keep working; the links in the docs can then be
  updated in one step.
- Register the domains and run a trademark search before announcing the name ⚖️.
