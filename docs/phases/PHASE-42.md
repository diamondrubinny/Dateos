# Phase 42: Add to calendar (v1.15)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

An accepted date and an event you're going to now have an **Add to calendar** button.

## What it does

- Makes a standard calendar file (`.ics`, RFC 5545) **on the device**: nothing new is sent to the
  server, and no calendar service is contacted. Web: a download the browser hands to the calendar
  app. iPhone and Android: the system share sheet (Calendar, Files…) 📘 expo-file-system /
  expo-sharing.
- **A date** (phase 12): "Meeting at {place}", the place's name and address, from the date's time
  for 2 hours. **Discreet on purpose**: no name of the other person, no app name, because calendars
  sync to other devices and show on lock screens and shared screens. The button's hint says so.
- **An event** (phase 14): its title, place and real start and end, while it hasn't ended.
- Each file has a stable UID (`date-<id>@local`, `event-<id>@local`), so adding it again updates
  the entry instead of duplicating it.

## Details

- `packages/shared/src/calendar.ts`: `icsFile()` escapes `\ , ;` and new lines, ends lines in CRLF,
  folds them at 75 octets without splitting a character (Hebrew and Arabic are two bytes each), and
  writes times in UTC. Unit tests.
- Hebrew title "פגישה: {place}" (not a prefixed ב, which breaks next to Latin place names).

## Order of work

1. shared `icsFile` + unit tests.
2. App: the buttons on DateCard and the event screen; i18n ×4. e2e `pnpm --dir e2e calendar`
   (reads the downloaded file).
3. Docs, PR, CI, merge.
