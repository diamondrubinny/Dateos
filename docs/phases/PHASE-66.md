# Phase 66a: Blurred profile photos, shown to a match by choice (v1.40)

> Status: ✅ 66a done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.
> First part of "control over exposure" (`docs/research/market-gaps-2026-10.he.md`, item 5).
> 66b: Match Note (a private card shown after a match). 66c: private albums.

## The gap (checked in the code)

- Profile photos are either visible or not: `/v1/photos/:id` serves the full photo to anyone allowed
  to see the profile. Only chat images are hidden until tapped. A closeted LGBTQ+ member, a modest
  religious member or someone in a small town can't be seen without being recognised.
- A community can't choose "photos only after a match" (text first, as Lex does).
- Muzz blurs photos as a personal choice; 77.6% of religious-Zionist singles want a photo, so this
  is a choice, never the default.

## What changes

| Part                               | Change                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blur my photos (member, off)       | Settings: other people see my photos blurred. In a chat, "Show my photos to …" reveals them to that match only; "Blur them again" takes it back. Ending the match takes it back too.                                                           |
| Photos after a match (admins, off) | Dashboard → Branding → Community profile: everyone's photos are blurred until two people match; then they're clear (unless the member blurs them).                                                                                             |
| Blurred is blurred on the server   | A blurred photo is made on the server (tiny and blurred), never the real photo hidden by the app; its description for screen readers isn't sent either. Responses for such photos aren't cached (`no-store`), so taking it back works at once. |
| App                                | A blurred photo shows a lock and says why ("{name} shows photos to matches by choice", or "Photos are shown after a match"). The profile preview (phase 44) shows what strangers see.                                                          |
| Partners                           | A member who blurs, or a community with photos after a match, sends partners blurred photos only.                                                                                                                                              |

## Security and privacy ⚖️

- Nothing new is collected: one setting, and which matches a member showed their photos to (deleted
  with the match or the account; in "Download my data").
- ⚠️ A match who sees the photo can still screenshot it; the app says so before revealing. 📘
- Moderators still see real photos (reports need them; audited since phase 4).

## Tests

- Unit: the blur rule (owner, stranger, match, revealed, community mode).
- Integration: off by default; blurred for strangers and matches until revealed; reveal only to a
  match; take back; unmatch takes back; community mode clear after a match; the served bytes are
  small and not the original; no-store; description withheld; partner cards; export.
- e2e (en, he): a member blurs their photos; a match sees the lock, the member reveals; the match
  sees the photo; an admin turns on "photos after a match". axe 0. Screenshots.

## Order of work

1. Shared schemas; DB column, table, instance setting; migration.
2. API: the rule, photo serving, cards, reveal routes, partner cards, export; tests.
3. Dashboard toggle; app settings, photo lock, chat reveal; i18n ×4.
4. e2e, docs, PR, merge.

## Done (66a)

- **Integration** (5, `photo-blur.test.ts`): off by default (real photo, cached as before);
  blurred on the server for others (16 px wide), `no-store`, no description, the owner sees it
  clear and the preview shows what strangers see; matching alone doesn't show it; shown to one
  match by choice, only to them; someone else can't show it in a match that isn't theirs; taken
  back; ending the match hides it again; a community with photos after a match: blurred for
  strangers, clear for matches (both ways); in "Download my data".
- **e2e** `pnpm --dir e2e photo-blur` (en, he): the member blurs in Settings; a match sees the
  lock and "Noa shows photos to matches by choice"; the member shows them from the chat; the match
  sees the photo. axe 0. Screenshots `151-photo-blurred`, `152-show-my-photos` (en, he).
- Partners: cards carry `blurred` (older partners ignore it) and no description; the photo route
  sends partners a blurred copy.
- Found on the way: the chat row first put a long sentence beside its button and squeezed it into
  a narrow column; it's stacked now.
- Docs: PRIVACY.md, CHANGELOG, README.

### Next

- 66b: Match Note, a private card shown only after a match.
- 66c: private albums with one-time, 10-minute or unlimited viewing.

---

# Phase 66b: Match Note, a card only matches see (v1.41)

> Status: ✅ done (2026-10-31).

## The gap

Things people want a match to know before meeting (a wheelchair, a hidden disability, being trans,
being a single parent, keeping kosher) either go on the public profile, seen by everyone, or wait
for an awkward moment. Hinge's Match Note (about 2 in 3 testers said it helped, according to the
company) and Dateability's "Deets" fill this gap.

## What changes

| Part        | Change                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Match Note  | Profile → "Note for matches": up to 500 characters of plain text, written by the member. Deleted by clearing it.                                             |
| Who sees it | Only people the member has an open match with: on their profile and from the chat. Never strangers, the member's own "as others see it" preview or partners. |
| Safety      | Hurtful words are refused, as elsewhere; it needs the sensitive-data consent, since it may say something sensitive ⚖️.                                       |
| Data        | In "Download my data"; deleted with the account.                                                                                                             |

## Tests

- Integration: saved, cleared, refused without consent or with markup or hurtful words; a stranger
  doesn't get it, a match does, and loses it when the match ends; the preview doesn't show it;
  export.
- e2e (en, he): a member writes a note; a match sees it on the profile; a stranger doesn't. axe 0.

## Done (66b)

- **Integration** (4, `match-note.test.ts`): saved with line breaks and cleared; markup, too long,
  blank and hurtful words refused; refused without the sensitive-data consent; a stranger doesn't
  get it, a member before the match doesn't either, a match does, the member's preview doesn't, and
  it's gone when the match ends; in "Download my data".
- **e2e** `pnpm --dir e2e match-note` (en, he): the member writes the note from the profile tab; a
  stranger doesn't get it from the API; a match sees "A note from Noa for matches" on the card.
  axe 0. Screenshots `153-match-note-edit`, `154-match-note-card` (en, he).
- Found on the way: the hurtful-words filter caught "you idiot" but not "you are all idiots";
  English words now match with plural endings (unit test; "idiomatic" still passes).
- Docs: PRIVACY.md, CHANGELOG, README.
