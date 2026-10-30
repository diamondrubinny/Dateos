# Phase 63: Age assurance through a provider of the community's choice (v1.37)

> Status: 🚧 in progress. 📘 = verify against official docs, ⚖️ = needs legal review.
> From the research (`docs/research/next-phases-2026-10.he.md`, `market-gaps-2026-10.he.md`):
> the UK Online Safety Act expects dating services to use "highly effective age assurance"; the EU's
> Art. 28 guidelines (July 2025) say self-declaration isn't enough; EU member states must offer an
> EUDI wallet by December 2026. Nothing here is legal advice.

## The gap (checked in the code)

- Age is a self-declared date of birth (`MIN_AGE`, phase 1; join rules, phase 62c). There's no way
  for a community to require an age check, nor to plug in a provider.

## What changes

| Part | Change |
| --- | --- |
| Provider (operators) | A generic, signed adapter: the app sends the member to the provider's page (`AGE_CHECK_URL`, with a one-time session id and where to return); the provider sends the result to the server, signed with a shared secret (`AGE_CHECK_SECRET`, HMAC-SHA256, with a timestamp). Works with any provider that can do this directly or through a small bridge 📘 (EU age-verification app / EUDI wallet, facial age estimation, ID + liveness). |
| Only the result | Stored: over 18 or not, the method the provider names, when. Never a document, photo or date of birth. Under 18 → the account is suspended as today (phase 1). |
| Community setting (admins) | "Require an age check": only when a provider is configured on the server. Members without a passed check are asked before they can use the app; members already checked aren't asked again. |
| Safety | One-time sessions that expire after 15 minutes, bound to the member; the signature and a timestamp within 5 minutes are checked in constant time; replays and other members' sessions are refused; the secret never leaves `.env`. |
| App | Onboarding step "Confirm your age": why, what is kept, a button to the provider, and a page that waits for the result. |
| Local testing | `e2e/fake-age-provider.mjs`: a pretend provider that signs results, for tests only. |

## Security and privacy ⚖️

- The provider is a processor of what the member shows it (possibly biometric data): the operator
  needs an agreement with it (DPA), possibly a DPIA ⚖️. The community stores only the result.
- The member is told before leaving the app which provider will be used and what comes back.

## Tests

- Unit: signing and checking (good, wrong secret, old timestamp, tampered body).
- Integration: off by default; can't be required without a provider; a session per member, one use,
  expires; a signed "over 18" marks the member, the step disappears; "under 18" suspends; a bad
  signature, an old timestamp, a replay or another member's session is refused; export; deleted with
  the account.
- e2e (en, he): an admin requires the check; a new member is sent to the fake provider and back;
  the app continues. axe 0. Screenshots.
