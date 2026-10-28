# Phase 34: Anti-bot and fake profiles (v1.7)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

**Already in place:** captcha on sign-in and the waitlist (phase 24), invite codes and a waitlist
(21f), duplicate and banned photos by perceptual hash (21a), ban evasion by email HMAC and photo
hashes (21b), scam warnings in chat (phase 3), photo verification by a moderator (phase 4).

**This phase** adds signals from _behaviour_ that bots and fake profiles show, each one explained
to the moderator, and a filter for members. **Principles:**

- No IP or device fingerprinting, no tracking outside the product (as in 21b) ⚖️.
- No hidden punishment ("shadow bans"). Automatic checks open a **report for a human moderator**
  with the reason in plain words; the only automatic action is a short, visible slowdown.
- Everything is computed from data the product already has, in Postgres; nothing new is kept.

## 34a. Bot behaviour

1. **The same message to many people.** The same text (normalized: lowercase, spaces collapsed,
   at least 15 characters) sent to **5 or more different chats within 24 hours** → an automatic
   report: category _spam_, "Sent the same message to 5 chats in 24 hours".
2. **Links and money talk from a brand-new account.** An account less than 24 hours old whose
   messages carry scam signals (a link, moving off the app, money, crypto, gift cards) in **3 or
   more different chats within 24 hours** → an automatic report: _scam_, high priority.
3. **Liking too fast.** More than **40 likes in 10 minutes** (no person reads 4 profiles a minute
   for 10 minutes) → "Slow down a little" (429) until the window passes. Hitting it 3 times in a
   day → an automatic report: _spam_.

## 34b. Fake profiles

4. **Copied profile text.** A bio or prompt answer of 40+ characters identical (normalized) to
   another active account's → an automatic report on the account that saved the copy:
   _fake_profile_, "Profile text identical to another account's". The original isn't reported (its
   owner may be the one who was copied).
5. **"Verified profiles only"** (Preferences): Discover, Picks, the friends deck and speed dating
   show only people whose photos a moderator verified. Off by default.

## 34c. In the dashboard

- Automatic reports show their reason (and say they're automatic, as in phase 21); at most one
  open automatic report per account and category, so a flood can't flood the queue.
- Audit: `report.automatic` with the reason code only.

## Data

- `preferences.verified_only` (default false). Migration `0043_verified_only.sql`.
- No new tables: the checks query `messages`, `interactions`, `profiles` and `prompts`.

## Order of work

1. API checks + auto-report helper; preference + discovery rule; integration tests.
2. App: "Verified profiles only" switch; "Slow down" message; i18n ×4. e2e.
3. Docs (privacy: the checks), PR, CI, merge.
