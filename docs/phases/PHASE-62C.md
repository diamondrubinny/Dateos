# Phase 62c: Who may join, and presets for common communities (v1.36)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.
> Third part of "community profile and identity vocabulary" (`docs/research/market-gaps-2026-10.he.md`).

## The gap (checked in the code)

- `MIN_AGE` is a constant (18); there's no maximum. A 50+ community (like SilverSingles in the
  research) or a 25–40 community can't say so; nor can a women-only community (HER, Hey! VINA).
- No community declaration ("I am single", "I am looking for marriage", "I agree to the
  community's rules"): religious and closed communities ask for one before joining.
- Every setting from 62a/62b is a separate choice: an operator starting a faith community or an
  LGBTQ+ community has to know which to pick.

## What changes

| Part                            | Change                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ages (admins)                   | A minimum (18–99, never below 18) and an optional maximum. Checked when a profile is created; the app says the range before asking. Members already in keep their place.                                                                         |
| Who joins by gender (admins) ⚖️ | Optional: e.g. women and nonbinary people only. Empty = everyone. Checked at profile creation. Equality law differs by country; the dashboard says so.                                                                                           |
| Declaration (admins)            | Optional text (up to 300 characters) every new member confirms when creating the profile; when it was confirmed is stored.                                                                                                                       |
| Presets (dashboard)             | One click fills and saves the identity, community-profile and age settings for: general, LGBTQ+, faith and marriage, 50+, friendship only; every field stays editable afterwards. The gender list and declaration are never changed by a preset. |
| App                             | Onboarding shows the community's age range and declaration, and explains a refusal plainly.                                                                                                                                                      |

## Security and privacy ⚖️

- Nothing new is collected about members except when they confirmed the declaration.
- Restricting membership by gender, age or belief may be lawful for some communities and not for
  others (e.g. equal-treatment rules for services) ⚖️: the dashboard says this next to the settings.

## Tests

- Unit: the settings schema (minimum never below 18, maximum ≥ minimum, declaration length).
- Integration: a 30-year-old can't create a profile in a 50+ community, a 55-year-old can; above the
  maximum is refused; a gender outside the list is refused; without confirming the declaration it's
  refused, with it the time is stored; existing members unaffected; defaults change nothing.
- e2e (en, he): an admin applies the "50+" preset with a declaration and saves; onboarding shows the
  range and the declaration; a member confirms and joins. axe 0. Screenshots.

## Order of work

1. Shared settings and errors; DB columns; migration.
2. API: settings, profile creation checks, instance info; tests.
3. Dashboard: "Who may join" card with presets. App: onboarding; i18n ×4.
4. e2e, docs, PR, merge.

## Done

- **Unit** (shared, 2): ages never below 18, a maximum can be cleared; genders from the matching
  list, each once; a plain-text declaration up to 300 characters.
- **Integration** (6, `join-rules.test.ts`): defaults change nothing; an age range refuses outside
  it with `NOT_ELIGIBLE` and no suspension, accepts inside; settings refuse below 18 and a maximum
  below the minimum (also against the saved minimum); genders; a declaration must be confirmed and
  the time is stored; markup refused; members already in keep their place.
- **e2e** `pnpm --dir e2e join-rules` (en, he): an admin applies the "50+" preset (the cards below
  show the new values) and adds a declaration; onboarding shows "50 and over" and the declaration;
  unconfirmed, then at 30, it's refused with a plain message; at 56 with the declaration confirmed
  the profile is created. The intention list follows the preset. axe 0. Screenshots
  `147-join-rules`, `admin-33-who-may-join` (en, he).
- Found on the way: after a preset, the cards below kept their old values (they remounted before
  the reload), so saving one of them would have written them back; they now restart from the saved
  values once they're loaded.
- Docs: PRIVACY.md, ADMIN.md (7e), CHANGELOG, README.
