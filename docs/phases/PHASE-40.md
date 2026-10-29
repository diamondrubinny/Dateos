# Phase 40: Photo descriptions (v1.13)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

Profile photos were read to screen-reader users as "Maya, photo 1 of 3": nothing about what's in
them. Dating is visual; this is the biggest gap for blind and low-vision members (WCAG 1.1.1, text
alternatives: the member is the only one who knows what a photo shows).

## Describe your photos

- **Edit photos** (Profile → Photos, and during sign-up): a "Describe your photos" section, one
  optional field per photo that passed the checks: "What photo 1 shows", up to **150** characters,
  with an example. Saved per photo; empty clears it.
- **On profile cards** (Discover, Picks, a profile): the photo's accessible name becomes "Maya,
  photo 1 of 3. Me hiking at sunrise, with my dog". The member's own photo tiles say it too.
- Checked like other profile text: harmful wording is refused ("Please rephrase").
- `PUT /v1/me/photos/:id/description` `{ description }`: only my own profile photos (404
  otherwise); rate-limited. `/v1/me` and public profiles carry `description` per photo.
- Data: `photos.description` (migration `0047_photo_descriptions.sql`); deleted with the photo or
  the account; in "Download my data".
- Not yet sent to partner communities (phase 28b): their card format has no description field;
  adding it is a protocol change for a later phase.

## Order of work

1. db, shared, API; integration tests (own photos only, harmful text, length, export).
2. App: the section on the photos screen; accessible names on cards and tiles; i18n ×4. e2e
   `pnpm --dir e2e photo-descriptions`.
3. Docs, PR, CI, merge.
