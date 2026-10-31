# Phase 73b: Trust signals between partner communities (v1.58)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 73 (trust and privacy in federation), the
> base: controlled sharing of trust signals, such as hashes of banned photos, that lead to **human
> review, never an automatic block** (as the Tech Coalition's Lantern does), and an appeal that
> withdraws the signal from every partner (phase 61).

## What's here today (checked in the code)

- Banning a member keeps the perceptual hashes (64-bit dHash) of their photos; a new account with
  a photo within 6 bits of one is rejected and reported (phase 21). Lifting the ban, by an admin or
  on appeal (phase 61), deletes those hashes.
- Partners can send each other reports about each other's members (28d), through a signed
  outbox that retries for 7 days.
- Nothing about a banned person ever reaches a partner.

## What changes

| Part         | Change                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The setting  | Dashboard → Partners → "Trust signals" (off by default): share the photo hashes of members we ban with partners, and accept theirs. Both sides must turn it on for anything to be kept.                                                                                                            |
| Sending      | When an admin bans a member, the hashes of their photos (at most 20) and the report's category go to every connected partner, under a random signal id. No name, alias, account, photo or text.                                                                                                    |
| Receiving    | A partner's signal is kept as hashes only. Members here whose profile photo is within 6 bits of one get an automatic report for moderators ("matches a photo another community banned for…; not proof"), now and when they add a photo later. Nothing is hidden, rejected or banned because of it. |
| Withdrawing  | Lifting the ban (an admin, or an accepted appeal) withdraws the signal from every partner, which deletes it. Ending a partnership deletes what it sent.                                                                                                                                            |
| Transparency | The partner list shows how many signals each partner sent and how many are kept.                                                                                                                                                                                                                   |
| Retention    | Signals are kept for 2 years at most, here and in what we track for withdrawal.                                                                                                                                                                                                                    |

## Security and privacy ⚖️

- A perceptual hash can't be turned back into a photo, but it is still derived from a person's
  image: sending it to another operator is a transfer of personal data ⚖️ (the partnership
  agreement must cover it). Off by default.
- The receiving side can't learn who was banned; it only learns that someone here posted a
  similar photo, and a human decides. A wrong ban spreads only as a review, and is withdrawn on
  appeal.
- Only connected partners, signed requests, at most 20 hashes per signal, at most 500 signals per
  partner per day.

## Tests

- Integration (two servers): off by default (nothing sent, nothing kept); on both sides, a ban
  sends a signal without identifiers; the partner reports a matching member for review and nothing
  else; a later photo upload matching it is reported too (worker); lifting the ban withdraws it;
  ending the partnership deletes it; malformed or oversized signals refused; retention.
- e2e (en, he): the setting in the dashboard, the counts on the partner, and the automatic report
  in the moderation queue. axe 0. Screenshots.

## Done

- **Integration** (`federated-safety.test.ts`, two servers, "phase 73b"): off by default (a ban
  sends nothing); on at the sender only, the partner keeps nothing; on at both, the signal carries
  only an id, the hashes and the category; a member there with a photo one bit away gets a
  high-priority automatic report saying it's not proof, and stays active with the photo
  published; a member with a different photo gets nothing; the partner list counts it; lifting
  the ban withdraws it; malformed signals (bad id, non-numbers, out of range, more than 20 hashes,
  extra fields) and unsigned ones are refused; turning sharing off and ending the partnership
  forget them. `trust.test.ts`: a new photo like a partner's signal is published and reviewed,
  never rejected, and only where sharing is on; its case isn't hidden by another automatic case.
  `retention.test.ts`: 2 years, and everything once sharing is off. Unit (`trust-signals.test.ts`):
  the 64-bit hash format.
- **e2e** `pnpm --dir e2e trust-signals` (en, he, between two real servers): A's admin turns it
  on in the dashboard; B bans a member; A's dashboard shows the signal on the partner and the
  report on A's member with a similar photo; B lifts the ban and A forgets the signal. axe 0.
  Screenshots `admin-15-trust-signals`, `admin-16-signal-report`.
- Found and fixed on the way: an automatic case of one kind (a copied photo) used to hide a new
  one of another kind; now each kind has its own case.
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- Sharing scam scripts (text patterns): a signal from free text is much harder to keep free of
  personal data, so it waits for real need.
- Telling the reviewing moderator when the partner withdraws the signal behind an open case.
