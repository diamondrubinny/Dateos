# Phase 69: A live check through a provider, and asking a match kindly to verify (v1.49)

> Status: ✅ done (2026-10-31). 📘 = verify against official docs, ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 69: a liveness check through the provider
> interface of phase 63, a face template nobody can rebuild a face from, the selfie deleted by
> default, verification optional. Duplicate and banned photos are already caught by perceptual
> hash (phase 21a).

## The gap (checked in the code)

- Photo verification (phase 4) is human: a selfie with a pose, compared by a moderator. It's slow
  for a busy community and needs moderators online; there's no automated check a community can
  plug in.
- Fake profiles are the first complaint in app-store reviews (PLOS ONE). Dateability lets a member
  kindly ask the other side to verify; we can't.

## What changes

| Part                              | Change                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider (operators)              | A signed adapter like phase 63's: `LIVENESS_URL` and `LIVENESS_SECRET` (both or neither). The app sends the member to the provider with a one-time session (15 minutes); the provider may fetch **only** the member's first profile photo through that session, once, to compare; it posts back a signed result: passed, failed or doesn't match the photo, and its method 📘. |
| What the community keeps          | The result, the method and when. Never the selfie, the video or a face template: those stay with the provider, which the operator must bind by contract to delete them ⚖️.                                                                                                                                                                                                     |
| Passed                            | The member's photos get the verified badge at once, as when a moderator approves; changing profile photos removes it, as today.                                                                                                                                                                                                                                                |
| Failed or no match                | Nothing changes; the member can try again or use the human check (phase 4), which stays.                                                                                                                                                                                                                                                                                       |
| The verify screen                 | When a provider is set up: "A quick live check" first, the human check second; says which provider and what comes back.                                                                                                                                                                                                                                                        |
| Ask kindly to verify (any member) | In a chat with someone not verified: "Ask {name} to verify". Once per chat. They see a gentle card ("{name} would feel more at ease if you verified your photos") with a button to verify; nothing happens if they don't. Gone once they're verified.                                                                                                                          |

## Security and privacy ⚖️

- Biometric data never reaches the community's server. The provider is a processor that may handle
  it: DPA, possibly a DPIA, and explicit consent before leaving the app ⚖️ 📘.
- The photo link works only for that session, only before the result, and only for that member's
  first profile photo; sessions are one-time, bound to the member and expire.
- Signatures and timestamps as in phase 63 (HMAC-SHA256, 5 minutes, constant-time).

## Tests

- Unit: the liveness signing string; good and bad signatures.
- Integration: off without a provider; a session per member, one use, expires; the provider fetches
  the first photo through the session once and only before the result; passed → verified badge;
  failed / no match → no change; bad signature, old timestamp, replay refused; asking to verify:
  once per chat, only someone not verified, the card for them only, gone once verified; export.
- e2e (en, he): with a pretend provider, a member does the live check and gets the badge; in a
  chat, a member asks the match to verify and the match sees the card. axe 0. Screenshots.

## Done

- **Integration** (4, `liveness.test.ts`): without a provider, not offered; the provider fetches the
  first photo through the session once (`no-store`), a signed "passed" gives the badge and only
  the result, method and time are stored; a replay, a wrong secret, an old timestamp are refused;
  "no match" gives nothing; photos changed during the check give nothing; the photo can't be
  fetched after the result. Asking to verify: once per chat, only in my own chats, the card only
  for the other person, gone once they're verified, never for someone verified.
- **e2e** `pnpm --dir e2e liveness` (en, he, with `e2e/fake-liveness-provider.mjs`): the member
  starts the live check, the pretend provider fetches the photo, "Passed" gives the badge; the
  verified member asks the match to verify and the match sees the card. axe 0. Screenshots
  `173-live-check`, `174-verify-asked` (en, he).
- The signing string starts with "liveness." so an age-check result can never pass as a live check
  (or the other way round).
- Docs: SELF_HOSTING.md ("Live checks"), `.env.example`, PRIVACY.md, CHANGELOG, README.

### Not done here

- Re-checking existing badges with the provider (a moderator's badge stays as it is).
- Telling partner communities how a member was verified (the badge travels, not the method).
