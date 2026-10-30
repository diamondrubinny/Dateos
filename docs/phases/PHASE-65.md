# Phase 65: Protection on the receiving side (v1.39)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.
> Item 4 of the market research roadmap (`docs/research/market-gaps-2026-10.he.md`).

## The gap (checked in the code)

Already there: the receiver sees a "Stay safe" banner on messages with money, crypto, gift-card,
off-platform or link signals (English, Hebrew, Arabic, Russian), hurtful messages arrive hidden, new
accounts can start only a few chats a day, and "verified profiles only" filters what _I_ see.
Missing:

- **Being flooded.** Nothing limits how many new people see and like a member in a day; the people
  most liked (often women) have no way to slow it down.
- **"Only verified members can write to me"** (Feeld, January 2025): "verified only" filters my own
  Discover, but anyone I match with can write to me.
- **Sextortion.** Threats to share images unless the person pays are the most urgent case (FTC
  warning on LGBTQ+ apps), and nothing recognises them or points the receiver to an urgent report.
- **Local scam phrasing**: cheques, a "matchmaker" who wants money first, a parcel stuck at customs,
  in Hebrew, Arabic and Russian.

## What changes

| Part                          | Change                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New likes a day (receiver)    | Settings → "Who can reach me": off, 10, 25 or 50 new likes in 24 hours. Once reached, the member isn't shown to new people in Discover and Picks until it drops; people who already liked them and matches are unaffected. Nobody is told why.                                                                          |
| Only verified can write to me | Settings → "Who can reach me": unverified members don't see me in Discover and Picks, and can't write to me in a chat (text, voice, photos) unless I wrote first. They see "Only verified members can write to … Verify your photos to write." with a link to verification. Partner communities don't see such members. |
| Extortion signal              | A new signal for threats to share images or tell family unless the person pays (English, Hebrew, Arabic, Russian). The receiver sees an urgent banner: don't pay, don't delete the chat, report now; "Report" opens the report form with "Threat" chosen (urgent for moderators).                                       |
| Local scam phrases            | Cheques, matchmaker or registration fees paid first, customs and release fees, in Hebrew, Arabic and Russian, as money signals.                                                                                                                                                                                         |

## Security and privacy

- Nothing new is collected: two settings, kept with the other preferences, in "Download my data".
- The like limit counts likes already stored; the sender is never told the member is full.
- Signals stay receiver-side banners, never a block: wording can be innocent. ⚖️ Messages kept as
  evidence follow the existing report evidence rules.

## Tests

- Unit (ai): extortion phrases in 4 languages and ordinary messages left alone; the new money
  phrases.
- Integration: the like limit hides a member from new people once reached and shows them again
  after 24 hours, not from someone who already liked them; verified-only hides from unverified
  viewers and partners, refuses an unverified sender's text, voice and photo, allows a verified
  one, allows a reply once the member wrote first; the messages page says so; extortion flag on the
  receiver's view only; settings saved, in the export.
- e2e (en, he): a member turns both on; an unverified match sees the explanation instead of the
  composer; an extortion message shows the urgent banner and "Report" opens the form with "Threat".
  axe 0. Screenshots.

## Order of work

1. ai lexicon; shared settings and signal; DB columns; migration.
2. API: settings, discovery filters, chat gate, partner feed; tests.
3. App: settings section, chat notice, banner, report preset; i18n ×4.
4. e2e, docs, PR, merge.

## Done

- **Unit** (ai, 3): extortion in English, Hebrew, Arabic and Russian; ordinary messages about photos
  and family left alone (phrases like "send them to your family" were dropped after they caught an
  innocent sentence); cheques, fees paid first and parcels at customs as money signals. App i18n:
  the same placeholders in all four languages.
- **Integration** (6, `receiver-protection.test.ts`): settings off by default, only 10/25/50, in
  the export; the like limit hides a member from new people once reached, older likes don't count,
  turning it off shows them at once, someone they liked still sees them; verified-only hides from
  unverified viewers, shows to verified ones and to someone they liked; an unverified match can't
  write (`VERIFIED_ONLY`), the messages page says so, the receiver sees nothing; once the member
  writes, the other can answer; a verified match writes first; an extortion message is flagged
  for the receiver only.
- **e2e** `pnpm --dir e2e receiver-protection` (en, he): the member chooses "Up to 25" and
  verified-only in Settings; the unverified match sees the explanation and "Verify my photos"
  instead of the message box (and no suggested openers); a threat shows the urgent banner, and
  "Report" opens the form with Threat chosen and the chat attached. axe 0. Screenshots
  `148-who-can-reach-me`, `149-verified-only-chat`, `150-extortion-banner` (en, he).
- Found on the way: an empty chat's message list had a label but no role (axe flags it once the
  openers are hidden); it's now a named region.
- Partner communities: members who chose verified-only aren't shown to partners (we can't vouch
  for partners' verification). Messages in partner chats that already exist aren't limited.
- Docs: PRIVACY.md, CHANGELOG, README.

### Next

- A tone label for friendship-only communities, and wording for 50+ communities (from the
  research), once there's feedback on the signals above.
