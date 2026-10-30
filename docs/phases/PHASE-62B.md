# Phase 62b: Marriage, relationship history and a faith module, chosen by each community (v1.35)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.
> Second part of "community profile and identity vocabulary" (`docs/research/market-gaps-2026-10.he.md`).

## The gap (checked in the code)

- Intentions are five (`long_term`, `short_term`, `open`, `friends`, `unsure`): no "marriage", which
  religious and many 30+/40+ communities lead with (in a 2025 survey of religious-Zionist singles,
  the whole conversation is about marriage). A community can't drop options it doesn't want.
- Religion is five generic levels (not religious … very religious, spiritual): no faith, no stream
  (national-religious, Haredi, traditional…), no observance (Shabbat, kashrut, halal, prayer). Salams,
  JSwipe and Israeli shidduch platforms all ask these.
- No relationship history (never married, divorced, widowed), which "second chapter" sites in
  Israel are built around.

## What changes

| Part                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intentions                                       | New `marriage`. Matching treats it as closest to long-term. Partners on older versions get `long_term` instead, so nothing breaks across communities.                                                                                                                                                                                                                                                                                                 |
| Intentions offered (admins)                      | Dashboard → Branding → Community profile: which intentions this community offers (at least one). Members who already chose a removed one keep it until they change it.                                                                                                                                                                                                                                                                                |
| Relationship history                             | Optional: never married, divorced, separated, widowed. On the profile with the other "about me" fields.                                                                                                                                                                                                                                                                                                                                               |
| Faith module (admins turn it on; off by default) | Optional for members, with the existing religion consent: faith (Jewish, Muslim, Christian, Druze, Buddhist, Hindu, spiritual, none, other); a stream for Jewish, Muslim and Christian members (e.g. secular, traditional, national-religious, Torani, Haredi, Chabad, Conservative, Reform); observance questions that fit the faith (keeps Shabbat, keeps kosher, shomer negiah, halal, prays regularly, attends services), each yes / partly / no. |
| Dealbreakers                                     | "Faith" and "stream", both ways, a missing answer always passes (as the existing ones).                                                                                                                                                                                                                                                                                                                                                               |
| Partners (federation)                            | Faith, stream, observance and relationship history are never sent.                                                                                                                                                                                                                                                                                                                                                                                    |
| Data                                             | In "Download my data"; deleted with the account; withdrawing the religion consent deletes the faith answers too.                                                                                                                                                                                                                                                                                                                                      |

## Security and privacy ⚖️

- Faith and observance are special-category data (GDPR Art. 9; sensitive under Israel's privacy
  law): stored only with the `religion` consent; never ranked on, never sent to an AI model or to
  partners; used only as filters the member chooses.
- A community turning the module off hides the fields everywhere at once (kept, so turning it on
  restores them); members can delete their answers at any time.

## Tests

- Unit: catalogues, which streams and questions fit which faith, intention scores, the partner map.
- Integration: marriage saved and matched with long-term first; an intention the community doesn't
  offer is refused for new choices; faith refused without consent or while the module is off;
  stream must fit the faith; dealbreakers both ways with missing answers passing; withdrawing
  consent deletes faith answers; partner cards never carry them; export.
- e2e (en, he): an admin turns the faith module on; a member fills faith, stream and Shabbat; a
  profile card shows them; the dealbreaker hides a mismatch. axe 0. Screenshots.

## Order of work

1. Shared catalogues; DB enum value and columns; migration.
2. API: settings, about/faith, dealbreakers, discovery filters, federation map, export; tests.
3. Dashboard: Branding → Community profile. App: about screen, dealbreakers, card; i18n ×4.
4. e2e, docs, PR, merge.

## Done

- **Unit**: shared (3): streams and questions belong to their faith, clearing works, older clients
  without the new dealbreakers still validate, marriage travels to partners as long-term; ai (1):
  marriage is closest to long-term, then open, far from short-term.
- **Integration** (6, `faith.test.ts`): marriage chosen; a narrowed list refuses new choices but
  keeps an existing one; at least one intention; relationship history saved and shown, unknown
  values refused; the faith module off by default, then refused without consent, with a stream or
  question from another faith; saved, shown, hidden at once when turned off, restored; faith and
  stream dealbreakers both ways, missing answers pass, filters stop when the module is off;
  withdrawing consent deletes answers and filters; partner cards never carry faith; export.
- **e2e** `pnpm --dir e2e faith` (en, he): the admin turns the module on in the dashboard; a member
  consents and answers faith, stream and Shabbat in the app; another member sees "Jewish ·
  National-religious · Keeps Shabbat: Yes" / "יהדות · הציונות הדתית · שמירת שבת: כן" and
  "Marriage" on the card; a stream dealbreaker hides a mismatch. axe 0. Screenshots
  `145-faith-edit`, `146-faith-card`, `admin-32-community-profile` (en, he).
- Docs: PRIVACY.md, privacy policy en/he, ADMIN.md (7d), CHANGELOG, README.
