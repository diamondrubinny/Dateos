# Phase 21: Trust and safety automation (v0.7)

> Status: ✅ done (2026-10-23). Approved as part of the roadmap in
> [COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md).
> 📘 = verify against official docs, ⚖️ = needs legal review.

Fewer fake and banned accounts coming back, more control for members, with no fingerprinting and
no data sent to outside services.

## 21a. Duplicate photos (perceptual hash)

- The worker computes a 64-bit **perceptual hash (pHash)** of every profile photo it processes:
  shrink to 32×32 greyscale, take the 8×8 lowest frequencies of the discrete cosine transform, and
  set a bit for each one above their median.
  - The same photo, re-encoded, resized or a little brighter, stays within 6 bits.
  - A 3% crop stays within 12 bits.
  - Different photos are 26 bits or more apart.
  - These numbers were measured on real JPEGs and on textured images.
- Images with too little detail (a flat colour, a smooth gradient) get **no hash**, because theirs
  would be unstable and collide with every other flat image.
- Compared with Hamming distance in Postgres (`bit_count`) against:
  1. **Photos of banned accounts** (`banned_photo_hashes`), at ≤ 6 bits: the photo is rejected at
     once ("This photo can't be used"), and the account is flagged for review (high priority).
  2. **Other members' profile photos**, at ≤ 10 bits: this doesn't block. It opens an automatic
     report "Same photo as another account" (normal priority), because it can be innocent (a shared
     photo) or a catfish.
- Chat images aren't hashed or compared.
- A linear scan is fine for one community (100,000 photos in a few ms). An index (a BK-tree, or
  splitting the hash into bands) can come later.
- **Not included:** reverse image search on the internet (Google/Bing/TinEye) would send members'
  photos to an outside service ⚖️. Operators can add it as an opt-in later.

## 21b. Ban evasion (without fingerprinting)

- **Already there** (from phase 4): banning saves an HMAC of the normalized email (lowercase, no
  `+tag`, no dots in Gmail). A new account with that email is refused with the generic sign-in
  failure.
- **New:** the ban also saves the dHashes of the account's photos (`banned_photo_hashes`). A new
  photo that matches one is rejected, and the account is flagged for review (21a).
- **No IP or device fingerprinting.** It's disproportionate for this purpose under GDPR ⚖️, and
  carrier NAT makes IPs shared anyway.
- Retention is the same as for the email hashes: **until the ban is lifted** (lifting deletes both),
  with a periodic review of bans by the operator ⚖️.

## 21c. Screenshot protection (native)

- On chats, profiles, photos and calls, `expo-screen-capture` blocks screenshots and screen
  recording on Android (`FLAG_SECURE`). On iOS it blocks screen recording (from iOS 17 the system
  hides the content) 📘.
- **The web can't block screenshots.** We say so honestly in Settings and in the help text, and
  don't pretend.
- A member can't turn it off for others. Their own profile editor isn't protected.
- Not testable here (no real device) 📘.

## 21d. Hide me from my contacts

- "Don't show me to people in my contacts" (like Tinder's Block Contacts). Typical uses: an ex, a
  boss, family.
- **Native:** `expo-contacts` with explicit permission; only the email addresses are read. **Web:**
  a box to paste addresses.
- Normalized and hashed **on the device** (SHA-256). Only the hashes are sent, at most 2,000 per
  request.
- The server compares them with its members' email hashes **in memory**:
  - It stores **only the matches** as a silent two-way hide (`contact_hides`).
  - Hashes that didn't match are discarded at once and never logged.
- Nobody is told. Matches and chats that already exist aren't touched.
- To cover contacts who join later, run the check again (a button); we don't store non-members'
  hashes.
- ⚖️ A hash of an email address is still personal data (it can be guessed). It's processed only for
  this request, under the member's own request: contract, legitimate interest of the third parties.
  Needs legal review.

## 21e. Passkeys

- Sign in with a passkey (Face ID / fingerprint / Windows Hello) instead of a link by email:
  `@better-auth/passkey` 1.7.12, the official plugin, built on `@simplewebauthn`.
- Added in Settings after signing in with an email link. Each passkey is named and can be removed.
- The email link stays as a fallback.
- `rpID` comes from `WEB_URL`'s host.
- Native apps need Associated Domains (iOS) and Digital Asset Links (Android) for the community's
  domain 📘. Until those are set up, passkeys are offered on the web only.
- Staff keep TOTP MFA; a passkey is not a second factor for the dashboard.

## 21f. Invite codes and a waitlist

- A new instance setting, `signupMode`:
  - `open`: the default, same as today.
  - `invite`: an invite code is needed.
  - `waitlist`: you join a waitlist, and a moderator approves you.
- **Invite codes:**
  - Created by admins, with a number of uses and an expiry.
  - Optionally, each verified member gets 3 personal invites (`memberInvites`).
  - Codes are random (10 characters, no confusable ones). Stored hashed, shown once.
- **Enforced in one place:** a `user.create` database hook in better-auth. A new account is created
  only if its email is allowed:
  - by a code redeemed with `POST /v1/signup/redeem`, which lets that email sign up for 24 hours, or
  - by an approved waitlist entry.
  - Otherwise the sign-up is refused with the same generic message.
- **Waitlist:**
  - `POST /v1/signup/waitlist` with an email and an optional short note. A moderator approves or
    declines in the dashboard; approval sends the email link.
  - The waitlist is deleted 90 days after a decision.
- Rate limits:
  - Redeeming a code: 10 attempts per hour per IP.
  - Joining the waitlist: 5 per hour per IP.

## API (new)

| Method and path                                                           | Who                  | What                                                         |
| ------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `POST /v1/me/contact-hides`                                               | member               | `{ hashes: string[≤2000] }` returns `{ hidden: number }`     |
| `DELETE /v1/me/contact-hides`                                             | member               | Removes all of my contact hides                              |
| `GET /v1/signup/mode`                                                     | public               | `{ mode }`                                                   |
| `POST /v1/signup/redeem`                                                  | public, rate-limited | `{ code, email }` returns 204, or 400 with a generic message |
| `POST /v1/signup/waitlist`                                                | public, rate-limited | `{ email, note? }` returns 202, always (no enumeration)      |
| `GET`/`POST /v1/admin/invites`                                            | admin + MFA          | List and create codes                                        |
| `GET /v1/admin/waitlist`, `POST /v1/admin/waitlist/:id/{approve,decline}` | moderator + MFA      | Review the waitlist                                          |
| `GET /v1/admin/photo-matches`                                             | moderator + MFA      | Duplicate-photo cases (in the reports queue)                 |
| better-auth `/v1/auth/passkey/*`                                          | member               | Register, list, delete, sign in 📘                           |

## Data (new)

- `photos.phash` (bigint).
- `banned_photo_hashes`: hash, user, created. Deleted when the ban is lifted.
- `contact_hides`: user, other, created.
- `invite_codes`: hash, created by, uses, max uses, expires.
- `signup_allowances`: email HMAC, until.
- `waitlist`: email, note, status, decided at.
- `passkey`: the plugin's table.

## Security and privacy

- All the new public endpoints are rate-limited and give the same answer whether or not the email
  exists.
- Email hashes use HMAC with a key derived from the server's master secret (as the bans already do;
  never in code). Invite codes are stored as SHA-256 hashes (they are random, so they can't be
  guessed back). The contact check uses plain SHA-256, because it happens on the device, and nothing
  that doesn't match is stored.
- Photo hashes aren't biometric data: they're computed from pixels, not faces. Still listed in the
  data map ⚖️.
- Every moderator decision is audited (approve, decline, a photo-match outcome).

## Decisions (recommended, adopted)

1. Duplicates with other members open a moderation case and don't block. Banned photos are rejected
   automatically.
2. No IP or device fingerprinting.
3. Contacts: store only the matches, never the hashes of non-members.
4. Passkeys on the web first; native after the domains are set up.
5. `signupMode` stays `open` by default, so nothing changes for existing communities.

## Results

- **pHash measured on real images:**
  - Re-encoding (WebP, a smaller JPEG): ≤ 4 bits.
  - A little brighter: ≤ 6 bits.
  - A 3% crop: 4–12 bits.
  - Different photos: 26 bits or more.
  - Thresholds: 10 bits for "same photo" and 6 for "banned photo". Images with too little detail
    get no hash.
- **Integration tests (`trust.test.ts`, 11):**
  - An automatic case for a copied photo (one per member, not one per photo).
  - Bans keep their photos out, and lifting a ban clears them.
  - A flat image gets no hash.
  - Contact hides work both ways, store only the matches, validate their input and can be undone; an
    existing match is unaffected.
  - Invite codes: forgiving about case and dashes, single use, revoked and expired codes refused,
    admins only.
  - Member invites need verification and the setting, at most 3.
  - The waitlist: approval email, account created, the address not in the audit log, retention.
  - Open mode by default; passkey registration offered to signed-in members only.
  - The full suite: **177/177**.
- **e2e `pnpm --dir e2e trust` in en/he/ar/ru**, through the dashboard and the app:
  - Invite mode with a code made in the dashboard; a wrong code is refused.
  - "How to join" instead of a link for a new address.
  - The waitlist with approval in the dashboard.
  - A **passkey** added and then used to sign in, with Chromium's virtual authenticator (CDP WebAuthn).
  - Hide me from my contacts by pasting addresses.
- Screenshots `74-signin-invite`, `75-waitlist`, `76-security`, `77-hide-contacts`, and in the
  dashboard `admin-11-joining`, `admin-12-waitlist`.
- **Dependencies:** both moderate advisories (esbuild, uuid in build-time tools) fixed with
  overrides. `pnpm audit --prod` has nothing open beyond the two reviewed ones.

## Changes while building

- Email bans already existed (phase 4), so 21b only adds the photo hashes, with the same retention
  (until the ban is lifted).
- dHash turned out unstable on smooth images (9 bits between a photo and its WebP copy), so the hash
  is pHash (DCT).
- Automatic reports have their own `automatic` column, so the dashboard says "automatic check"
  instead of "deleted account".
- `PUBLIC_APP_URL` (optional; the default is the first CORS origin) sets the domain for passkeys and
  links in emails.
- In invite or waitlist mode, new staff need a code (or approval) too. This is documented in
  SELF_HOSTING.md.
