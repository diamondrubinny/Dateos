# Phase 62a: Gender identity and pronouns, in the community's own vocabulary (v1.34)

> Status: ✅ 62a done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.
> First part of "community profile and identity vocabulary", the top item of the market research
> (`docs/research/market-gaps-2026-10.he.md`). 62b: intentions, faith and lifestyle catalogues;
> 62c: who may join, and presets.

## The gap (checked in the code)

- `genders` is a fixed list of four (`woman`, `man`, `nonbinary`, `other`), used both for "I am" and
  for "interested in". No way to say more (trans, genderqueer, agender…), no pronouns anywhere.
- Community settings (`instance_settings`) have branding, calls and sign-up only: a community can't
  choose what it offers.
- Tinder has offered dozens of gender terms and free text since 2016; Taimi built its list with
  GLAAD; LGBTQ+ communities expect it. A religious community may prefer the short list.

## What changes

| Part                                  | Change                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching gender                       | Unchanged: the four values stay what searches use ("show me to people looking for…"). Nothing about matching changes.                                                                                                                             |
| Gender identity (optional)            | A longer list (woman, man, trans woman, trans man, nonbinary, genderqueer, genderfluid, agender, bigender, two-spirit, intersex, questioning), translated in 4 languages; or the member's own words (2–30 letters) where the community allows it. |
| Pronouns / form of address (optional) | Feminine, masculine, neutral, any: "she/her, he/him, they/them, any" in English; "פנייה בלשון נקבה / זכר / ניטרלית / כל פנייה" in Hebrew; the same idea in Arabic and Russian, which inflect by gender too.                                       |
| Who sees it                           | The member chooses: everyone, or only matches (default: matches, so no one is outed to strangers). Pronouns follow the same choice.                                                                                                               |
| Community settings (admins)           | Dashboard → Branding → "Identity": the short list or the longer one; own words on/off (default off); pronouns on/off (default on). Turning something off hides it at once (kept, not deleted, so turning it back on restores it).                 |
| App                                   | Profile → "Gender identity and pronouns" screen; shown on the profile card under the name.                                                                                                                                                        |
| Partners (federation)                 | Never sent to partner communities.                                                                                                                                                                                                                |
| Data                                  | In "Download my data"; deleted with the account.                                                                                                                                                                                                  |

## Security and privacy ⚖️

- Gender identity can reveal sexual orientation or a trans history: special-category data (GDPR
  Art. 9) and "sensitive" under Israel's Privacy Protection Law. Stored only with the existing
  `sensitive` consent; optional; visible to matches only by default; never used for ranking, never
  sent to an AI model or to partners.
- Own words are plain text: letters, spaces, hyphen, apostrophe and slash only, 2–30 characters;
  shown as text, never as HTML; checked by the same filter as the rest of the profile.

## Accessibility

- Radio groups with legends; the own-words field has a label and a hint; a screen reader reads
  the card's line as "Gender identity: …, pronouns: …".

## Tests

- Unit: the schema (keys, own words rules, visibility default).
- Integration: save and read back; refused without consent and with keys/own words/pronouns the
  community turned off; "matches" hides it from someone who isn't a match and shows it to a
  match; the community turning it off hides it at once; partners never get it; export has it.
- e2e (en, he): an admin turns on the longer list and own words; a member sets "nonbinary, they"
  for matches only; a stranger doesn't see it, a match does. axe 0. Screenshots.

## Order of work

1. Shared `identity.ts`; DB columns; migration.
2. API: settings, `PUT /v1/me/identity`, `GET /v1/me`, profile cards, export; tests.
3. Dashboard: Branding → Identity. App: screen, card line; i18n ×4.
4. e2e, docs (PRIVACY, privacy policy, ADMIN, CHANGELOG, README), PR, merge.

## Done (62a)

- **Shared** (unit, 4): own words in any script (Hebrew, Arabic, Russian, Latin), 2–30 characters,
  no markup, digits, links or control characters; a list term or own words, not both; matches only
  by default; `allowedIdentity` shows only what the community offers now; a partner-community card
  drops it.
- **Integration** (5, `identity.test.ts`): the defaults (longer list, pronouns, no own words);
  saved and read back; "matches only" hides it from a stranger and from someone liked but not yet
  matched, shows it to a match and in the member's own preview; "everyone" shows it to strangers;
  own words refused while off, refused when unsafe or mixed with a list term, accepted (Hebrew and
  English) when on; turning the longer list or pronouns off hides them at once, the short list
  refuses new terms, turning back on restores; Discover unchanged; in "Download my data"; deleted
  with the account.
- **e2e** `pnpm --dir e2e identity` (en, he): an admin turns on own words in the dashboard; a member
  writes their own words and chooses feminine address (matches only by default); a stranger doesn't
  get it from the API; a match sees "Femme · she/her" / "קווירית · פנייה בלשון נקבה" on the card.
  axe 0. Screenshots `143-identity-edit`, `144-identity-card`, `admin-31-identity` (en, he).
- Docs: PRIVACY.md, privacy policy en/he, ADMIN.md (7c), CHANGELOG, README.

### Next

- 62b: intentions (marriage, friendship only…), a faith module (streams and observance questions)
  and lifestyle catalogues (diet, sobriety, children and custody, relationship history).
- 62c: who may join (minimum age above 18, age ranges like 50+, declarations) and presets.
