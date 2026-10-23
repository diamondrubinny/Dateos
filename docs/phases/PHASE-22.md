# Phase 22: Friends (v0.8)

> Status: ✅ done (2026-10-23). Approved as part of the roadmap in
> [COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md).
> 📘 = verify against official docs, ⚖️ = needs legal review.

57% of people still meet partners through friends. This phase brings friends into the app: they
can vouch for you, come on a date with you, or simply be the reason you're here.

## 22a. Friends' takes (like Hinge's)

- From the profile editor, a member makes a **link** and sends it to a friend (any app: WhatsApp,
  SMS, email).
- The link is random, stored hashed, used once, and valid for 7 days.
- The friend **doesn't need an account.** The page shows only the member's first name, and asks for:
  - their own first name (up to 40 characters);
  - how they know each other: friend, family, colleague or other;
  - a few words about the member (up to 200 characters).
- The text goes through the usual message filter. Links, phone numbers and emails are refused.
- **The member approves each take** before it's shown, and can remove it at any time. Declined
  takes are deleted at once.
- Up to 3 are shown on the profile, with the friend's first name and relationship.
- The page tells the friend clearly where the text will appear, who decides, and that they
  shouldn't write contact details or anything private ⚖️.

## 22b. Double date (like Tinder's)

- **A pair:**
  - A member invites a friend who is also a member, with a pair link (single use, 7 days).
  - The friend accepts while signed in.
  - Each member can be in one pair. Either of them can end it at any time.
- **Who a pair sees:** another pair is shown only if **each** of us may see **each** of them under
  the usual rules (gender, age, distance, dealbreakers, blocks, contact hides). It's the same single
  visibility query, run for both of us, with the two candidate lists intersected.
  - A pair whose members can't all see each other is never shown, so double dates never bypass
    anyone's preferences.
- **Liking:** either of us can like a pair, and the other one sees it ("Noa liked this pair").
- **A double match:** when both pairs liked each other, a **group chat of four** opens.
  - Text only for now, through the same harm and scam filters as 1:1 chats.
  - Messages update live.
- **Safety:**
  - Any of the four can report any of the others (the existing report flow, with the messages
    copied as evidence).
  - Any of the four can leave. Leaving closes the chat for everyone: four people with one missing
    isn't a double date.
  - A block between any two of the four closes it as well.
- Ending a pair closes its double chats.

## 22c. Friends mode (BFF)

- A separate deck, "**Find friends**", in addition to dating.
- Turned on in Settings, with its own age range and, optionally, the genders you'd like to meet as
  friends.
- **Never mixed with dating:**
  - Only people who turned friends mode on see each other.
  - Liking is per mode, and a match needs both likes in the same mode.
  - Matches are labelled "Friends" in the inbox.
- Each person still gets one decision per person in total, so nobody appears in both decks.
- The same visibility query, with `mode: 'friend'`:
  - **Applied:** active, not on a break, distance, photos, blocks, unmatches, contact hides,
    incognito.
  - **Not applied:** dating gender, intention and dealbreakers.
- `interestedIn` (orientation, sensitive) isn't used in friends mode.

## API (new)

| Method and path                                                                                | Who                     | What                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `POST /v1/me/takes/link`                                                                       | member                  | A new link for a friend (the token is shown once)                  |
| `GET /v1/takes/:token`                                                                         | public, rate-limited    | The member's first name and whether the link is still valid        |
| `POST /v1/takes/:token`                                                                        | public, rate-limited    | `{ name, relation, text }`; returns 201                            |
| `GET /v1/me/takes`, `POST /v1/me/takes/:id/{approve,decline}`, `DELETE /v1/me/takes/:id`       | member                  | Review and manage takes                                            |
| `POST /v1/pairs/invite`, `POST /v1/pairs/join/:token`, `GET /v1/me/pair`, `DELETE /v1/me/pair` | member                  | The pair                                                           |
| `GET /v1/pairs/discover`, `POST /v1/pairs/:id/like`, `POST /v1/pairs/:id/pass`                 | member, in a pair       | Double date                                                        |
| `GET /v1/doubles`, `GET`/`POST /v1/doubles/:id/messages`, `POST /v1/doubles/:id/leave`         | one of the four         | The group chat                                                     |
| `PUT /v1/me/friend-mode`                                                                       | member                  | `{ on, ageMin, ageMax, genders[] }`                                |
| `GET /v1/friends/discover`                                                                     | member, friends mode on | Friends deck; liking uses `/v1/interactions` with `mode: 'friend'` |

## Data (new)

- `friend_takes`: owner, friend's first name, relation, text, status, created, decided.
- `take_links`: token hash, owner, expires, used.
- `pairs`, `pair_links`, `pair_interactions`.
- `double_matches`: the two pairs, the four members as a snapshot, closed at.
- `double_messages`: sender, text, flags, created.
- `preferences`: friend_mode, friend_age_min, friend_age_max, friend_genders.
- `interactions.mode` and `matches.mode`, both defaulting to `date`.

## Security and privacy

- Every endpoint checks membership: of the take owner, of the pair, of the four. Test: IDOR.
- **Public take pages:**
  - 10 views and 5 submissions per hour per IP.
  - A wrong or used token gets the same generic answer.
  - Nothing about the member beyond their first name.
- **Friend's personal data (a non-member, ⚖️):** first name and the text.
  - Kept only while the take exists.
  - Deleted with the member's account, or when the member removes it.
  - Listed in the data map and the privacy policy.
- **Group chats:**
  - Deleted 30 days after closing, like 1:1 chats.
  - Each person's own messages are in "Download my data".
- Retention for pair links and take links: deleted once used or expired (daily job).

## Decisions (recommended, adopted)

1. A friend writes a take without an account. The member approves each one; at most 3 are shown.
2. Double date: all four must be mutually visible under the usual rules. Anyone leaving closes the
   chat for all.
3. Group chat: text only at first.
4. Friends mode is a separate deck and doesn't use orientation; one decision per person in total.

## Results

- **Integration tests (`friends.test.ts`, 8):**
  - Friends mode is its own deck, only between people who turned it on; dating gender and
    orientation aren't used.
  - A friends match needs both likes in friends mode, is labelled `friend`, and never shows up in
    Likes You.
  - A friend writes a take without an account and sees only the member's first name; links are
    single use; phone numbers and insults are refused; only the owner approves or removes it.
  - At most 3 takes are shown, and "Download my data" holds them.
  - One pair per person, single-use pair links.
  - A pair sees another pair only when all four can see each other: a member too far away, or a
    dealbreaker (smoking), hides the pair, and liking it is refused.
  - Mutual likes open a group chat of four; leaving closes it for all; a block between any two of
    the four closes it.
  - The full suite: **185/185**.
- **e2e `pnpm --dir e2e friends` in en/he/ar/ru:**
  - Friends mode turned on in Settings, the Friends deck, a friends match labelled "Friends".
  - A take written in a browser without an account, approved, then shown on the profile to someone
    else.
  - A pair made through an invitation link, another pair shown, a double match, and the group chat
    updating live.
  - The chat menu lets you report each of the other three or leave.
  - axe: 0 WCAG 2.1 AA violations.
- **Found and fixed while testing:**
  - The takes heading sat inside the `list` role (an axe error); it's outside now.
  - The group chat's report and leave buttons took half the screen; they're in a menu now.
  - Hebrew and Arabic "you matched as friends" now name the person, like the other languages.
- Screenshots `78-friend-mode`, `79-friends-deck`, `80-write-take`, `81-takes`, `82-profile-takes`,
  `83-pair-card`, `84-double-chat`.
- **Still to check:**
  - The take page's wording to a non-member, and keeping their first name and text ⚖️.
  - Sharing links through the native share sheet on real devices 📘.
