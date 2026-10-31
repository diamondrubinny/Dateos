# Phase 73a: Federation, less before a match, and no partners where it's dangerous (v1.57)

> Status: 🚧 in progress. ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 73 (trust and privacy in federation), parts
> 2 and 3: less data to partners before a match (netmatch.me's manifesto), and a federation policy
> that keeps a high-risk community from partners in dangerous countries. Sharing trust signals
> (part 1, photo hashes for human review) is phase 73b.

## What's here today (checked in the code)

- Members take part only with the `federation` consent; each is a random alias per partner; the
  viewer's request carries only what the filter needs (28b).
- The taxonomy is already mapped to a shared core (part 1 of the item): genders are the four
  matching genders, `marriage` travels as `long_term` (62b), and identity terms, faith, needs,
  location, voice and email never cross. Nothing to add there.
- Before a match a partner gets the full card: name, age, gender, intention, bio, languages,
  prompts, every profile photo, verified.
- A community can list countries at risk (67b), used for travel; partners have no country.

## What changes

| Part                             | Change                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Less before a match (community)  | Dashboard → Partners: "Before a match, partner communities see" the full card, or only the first name, age, gender, intention and first photo. A high-risk preset would pick the second.                                         |
| Less before a match (member)     | Settings → Partner communities: "Show partners only my first photo and name until we match", whatever the community chose.                                                                                                       |
| Photos follow the card           | With the short card, a partner can fetch only the first photo until there's a match; after a match, the other photos too.                                                                                                        |
| Our country                      | Dashboard → Partners: the community's country (optional), sent with its identity so partners can see it.                                                                                                                         |
| No partners where it's dangerous | Inviting, or accepting an invitation from, a community whose country is on our countries-at-risk list is refused, with the reason. Existing partners there are flagged in the list (not ended automatically: the admin decides). |

## Security and privacy ⚖️

- The country is self-declared by each community: a signal, not proof ⚖️. Refusing is the safe
  default; the admin sees why.
- Nothing new crosses; the short card sends less. Older partners ignore the new identity field.

## Tests

- Integration: the short card (community setting, then member setting) has no bio, prompts or
  extra photos; a partner can't fetch the second photo before a match, can after; the identity
  carries the country; invite and accept refused for a partner in a country at risk; an existing
  one flagged; the settings saved and exported.
- e2e (en, he): the dashboard settings and the flag; the member setting. axe 0. Screenshots.
