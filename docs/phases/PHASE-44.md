# Phase 44: See my profile as others do (v1.17)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

Members edit their profile on separate screens (bio, photos, prompts, about me, takes) and never
see the result as one card. They also can't tell why nobody new finds them: a forgotten break,
incognito, or a photo still in the scan.

## What

- **Profile tab → "See my profile as others do"** opens `/preview`: the same `ProfileCard` other
  people get, built by the same server code (`DiscoveryService.toProfiles`), so it can't drift.
  Distance and "why we matched" depend on who's looking, so they're left out (and the screen says so).
- **What hides me right now**, each with a button to fix it:
  `onBreak` (settings), `incognito` (settings), `noPhoto` (add a photo), `noLocation` (set your area).
  These are the rules of the candidate query (`visibility.ts`) that depend only on the member.
  Otherwise: "New people who fit your preferences can find you."
- **Photos still being checked**: their count, as they aren't shown to anyone yet.

## API

`GET /v1/me/preview` (signed in, 30/min) → `{ profile: PublicProfile, hidden: HiddenReason[],
pendingPhotos }`. No new data is stored or exposed: it's the member's own card.

An open-ended break has `paused_until = NULL`, so the shared `notOnBreak` check is NULL (not
false) there; the preview treats NULL as "on a break", as the candidate query does.

## Tests

- Integration `profile-preview.test.ts`: identical to the card someone else gets (minus distance
  and reasons); all four reasons; an ended break doesn't hide; needs a session.
- e2e `pnpm --dir e2e preview` (en, he): from the profile tab, own photo loads, incognito named with
  a working fix button; axe 0. Screenshots `117-preview`, `118-preview-hidden`.
