# Moderation guide for instance operators

Every NexaHeart instance needs people who handle reports. This guide covers staff roles, two-factor
authentication, the dashboard (`apps/admin`) and what each decision does.

> ⚖️ Moderation touches personal data (chat excerpts, photos, selfies). Check retention periods, your
> legal basis and your transparency notices with a lawyer before you open the instance to the public.

## 1. Staff roles

| Role        | Can                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------- |
| `moderator` | Review reports and evidence, dismiss, warn, suspend; approve or reject photo verification |
| `admin`     | Everything a moderator can, plus ban, lift suspensions and read the audit log             |

Roles are **never granted over HTTP**. The person signs in to the app once (so the account
exists), then an operator with shell access to the server runs:

```bash
pnpm --filter @nexaheart/api staff grant moderator@example.org moderator
pnpm --filter @nexaheart/api staff grant you@example.org admin
pnpm --filter @nexaheart/api staff list
pnpm --filter @nexaheart/api staff revoke former@example.org      # also removes their 2FA
pnpm --filter @nexaheart/api staff reset-mfa lost-phone@example.org
```

In the Docker image, use `node dist/cli/staff.js <command>` instead of `pnpm ... staff`. Every
command is written to the audit log.

## 2. Two-factor authentication (mandatory)

The first time a staff member opens the dashboard, they scan a QR code with an authenticator
app (TOTP, RFC 6238: Aegis, 2FAS, Google Authenticator, 1Password, and so on) and enter a code.

- Each session must pass a code check, which lasts **12 hours**.
- A code is accepted only once (replay protection) and within ±30 seconds.
- After 10 wrong codes in a row, 2FA locks until an operator runs `reset-mfa`.
- Once 2FA is set up it cannot be re-enrolled from the dashboard, so a stolen session cannot
  add a new device. Lost phone: `reset-mfa`.
- The TOTP secret is stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`). Rotating
  `AUTH_SECRET` therefore requires every staff member to set up 2FA again (`reset-mfa`).

## 3. Running the dashboard

The dashboard is a static site that calls the API with the staff member's session cookie.

```bash
pnpm --filter @nexaheart/admin build            # VITE_API_URL=https://api.example.org for production
pnpm --filter @nexaheart/admin preview          # local preview on http://127.0.0.1:5174 with security headers
```

Requirements:

1. Add the dashboard origin to `CORS_ORIGINS` (sign-in links are only sent back to trusted origins).
2. Serve it from the **same site** as the API (for example `admin.example.org` and
   `api.example.org`), so the session cookie (`SameSite=Lax`) is sent.
3. Send the security headers below. The build contains no inline scripts or styles, so the strict
   policy works as is.

Example for Caddy:

```caddy
admin.example.org {
  root * /srv/nexaheart-admin
  try_files {path} /index.html
  file_server
  header {
    Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src blob:; connect-src 'self' https://api.example.org; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    X-Frame-Options "DENY"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Cross-Origin-Opener-Policy "same-origin"
    X-Robots-Tag "noindex, nofollow"
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
}
```

Consider restricting the dashboard to a VPN or an IP allowlist as well.

## 4. Reports

Members report from a profile or a chat. They choose a category, can add a description and attach
the last 20 messages of the chat, including voice messages (staff can play them; every play is audited). **The server copies those messages itself**, so evidence cannot
be faked by the client and survives the 30-day purge of closed chats. Reporting also blocks by default.

| Priority  | Categories                                      |
| --------- | ----------------------------------------------- |
| 🔴 Urgent | Possibly under 18, threats or violence          |
| 🟠 High   | Scam or money request, harassment               |
| Normal    | Fake profile, inappropriate photos, spam, other |

Staff who have finished 2FA setup receive an email for urgent reports. The email contains no report content.

### Decisions

| Action  | Effect on the member                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dismiss | None. The report is closed                                                                                                           |
| Warn    | The app shows a warning with your explanation. Your internal note is never shown                                                     |
| Suspend | Signed out, all chats closed, hidden everywhere. Their other open reports are settled. They can still sign in to read why and appeal |
| Ban     | Like suspend, plus a keyed hash of the email (case, `+tags` and Gmail dots normalised) blocks new sign-ups. Admins only              |

Admins can lift a suspension or ban from the report page (with a reason). Suspensions for age are
never lifted from the dashboard.

**The reasons the member reads (phase 61).** A warning, suspension or ban needs two things beside
your internal note:

- **Ground**: the community's rules, or against the law. If it's the law, name it in the
  explanation. ⚖️ Ask a lawyer when unsure.
- **Explanation for the member** (10–1000 characters): the facts in plain words, what was found
  and which rule it breaks. Never who reported. The member reads it in the app (Settings → Security
  → "Decisions about my account", or the suspended screen), with the category, the date, and
  whether an automatic check found it. Your note and your name are never shown.

This is the "statement of reasons" the EU Digital Services Act asks of every hosting service
(Art. 17) 📘⚖️.

### Appeals (phase 61)

Members can appeal a warning, suspension or ban once, within 6 months, from the app (also while
suspended). Staff who finished two-factor setup get an email that an appeal is waiting (no
content). **Appeals** in the dashboard shows the decision, what the member was told, your internal
note and the appeal; choose **Keep the decision** or **Reverse the decision** and write a reply the
member reads.

- Not by the person who took the decision, unless they are the community's only admin.
- Suspensions and bans: admins only. Reversing lifts it (as "Lift suspension"), unless a later
  suspension or ban is in force. Reversing a warning withdraws it.
- The member is emailed that the appeal was reviewed (no outcome, no reply in the email) and reads
  the answer in the app. Every decision on an appeal is in the audit log.

The EU DSA asks online platforms for an internal complaint system for six months after a decision
(Art. 20); micro and small enterprises are exempt (Art. 19), but members of a small community
deserve the same ⚖️.

Safeguards: staff cannot act on reports that involve themselves, and cannot suspend other staff
(use the CLI). Every report view, photo view, selfie view and decision is audited.

## 5. Photo verification

The member gets a random pose (thumbs up, peace sign, …) and takes a live selfie. It goes through
the same quarantine → ClamAV → re-encode pipeline as all uploads. A moderator compares it with the
profile photos and approves or rejects. **There is no automated face recognition and no biometric
template.** The selfie is deleted as soon as a decision is made. Approved profiles show a ✓ Verified badge.

Members get 3 attempts per day. ⚖️ Even without templates, a selfie used to confirm identity may count
as sensitive data in some jurisdictions: ask for explicit consent and review it legally.

## 6. Retention (defaults, need legal review ⚖️)

| Data                       | Kept                                         |
| -------------------------- | -------------------------------------------- |
| Handled reports + evidence | 12 months after the decision                 |
| Moderation history         | 24 months                                    |
| Appeals                    | With the decision they are about (24 months) |
| Verification records       | 24 months (the selfie itself: until decided) |
| Unfinished verifications   | 7 days                                       |
| Banned-email hashes        | Until the ban is lifted                      |

The worker deletes expired records daily (`cleanup-discovery` job). Constants are in
`packages/shared/src/moderation.ts`.

## 7. Live events: speed dating and check-in (phase 23)

- **Video speed dating** is an event type (Events → Type). It needs video calls to be on (Branding →
  calls) and a capacity of at most 40. Rounds are 3 to 10 minutes. The server pairs people in the
  lobby by everyone's own settings; staff never see who met whom.
- **Check-in**: on the day, press "Check-in" next to the event and show the panel on a screen at the
  venue. The QR code and the 6-digit code change every 30 seconds; people going check in from 30
  minutes before the start until the end. Staff see only how many checked in.

## 7a. Event updates and questions (phase 27)

**Events → Updates and questions** on any event. Admins post short updates ("we moved inside")
until the event ends; everyone going or on the waiting list gets a notification without content.
Members going can ask a question; you see it **without who asked**, and only they see your answer.
If several people ask the same, post an update instead. Moderators can read, not write. Updates and
questions are deleted 30 days after the event; the audit log keeps ids only, never the text.

## 7b. Partner communities (phase 28a)

**Partners** connects this community with other NexaHeart communities you trust (off until the
server sets `FEDERATION=on`). Start from the draft
[partnership agreement](legal/partnership-agreement.en.md) ⚖️. Invite another community by its API address, or accept an invitation
that arrived; both need you to confirm that the two operators signed a data-sharing agreement ⚖️.
**Test connection** sends a signed ping; **End partnership** stops it on both sides at once. In this
step only the communities' names, addresses and public keys are exchanged, never anything about
members. Moderators can see the list; only admins decide.

**Members (phase 28b).** Once a partnership is active, members can join **Partner communities** in
the app (Settings, or Discover → Show → Partner communities). It's off for everyone until each
person turns it on; leaving or deleting the account tells every partner to forget them. Ending a
partnership deletes everything that crossed with that community on this server (the code names,
likes, passes, matches and their chats) and tells the other side to do the same. Chats across
communities (phase 28c) stay between the two people.

**Reports and suspension (phase 28d).** A report about one of your members from a partner
community appears in **Reports** like any other, the reporter shown as "a member of …" (who it
was stays with them), with the chat as evidence. Handle it with your own rules; the partner hears
only that it was reviewed. On **Partners**, each connection shows the reports sent, reviewed and
received, and **Suspend** pauses it at once: nothing crosses either way, nothing is deleted, and
**Resume** brings it back. Deletions you owe a partner that can't be reached wait in an outbox and
are retried for 7 days.

**Replacing the signing key.** If the server's key may have leaked (or as routine), **Replace the
signing key** on Partners makes a new one and tells every partner, signed with the old key. A
partner that's down is told within a week; after that, renew that partnership.

## 7c. Gender identity and pronouns (phase 62a, admins)

Dashboard → Branding → **Gender identity and pronouns**. Matching always uses the four genders
members choose when they join; this is how they describe themselves and how to address them:

- **Gender identity**: not offered, or a longer list (trans woman, trans man, nonbinary,
  genderqueer, genderfluid, agender, bigender, two-spirit, intersex, questioning…).
- **Own words** (off by default): up to 30 letters, checked like the rest of the profile.
- **Pronouns / form of address** (on by default): she/her, he/him, they/them or any; in Hebrew,
  Arabic and Russian, feminine, masculine or neutral address.

Members choose who sees it: their matches (the default) or everyone. It is never used for matching
and never sent to partner communities or an AI model. Turning an option off hides it from profiles
at once; members' choices are kept, so turning it back on restores them. ⚖️ This is special-category
data (GDPR Art. 9; sensitive under Israel's privacy law).

## 7d. Community profile: intentions and the faith module (phase 62b, admins)

Dashboard → Branding → **Community profile**:

- **Intentions members can choose**, including **marriage** (matched closest to long-term; partner
  communities see it as long-term). At least one. Members who already chose one you remove keep it
  until they change it.
- **Faith module** (off by default): members can add, with the religion consent, their faith, a
  stream (Jewish: secular, traditional, national-religious, Torani, Haredi, Chabad, Conservative,
  Reform; Muslim: Sunni, Shia; Christian: Catholic, Orthodox, Protestant) and observance questions
  that fit the faith (Shabbat, kashrut, shomer negiah, halal, prayer, services), and filter by
  faith and stream. ⚖️ Special-category data: never ranked on, never sent to partners or an AI
  model. Turning it off hides everything at once and stops the filters (kept, so turning it on
  restores them).

Relationship history (never married, divorced, separated, widowed) is always available in "About me".

## 7e. Presets and who may join (phase 62c, admins)

Dashboard → Branding:

- **Start from a preset**: General, LGBTQ+, Faith and marriage, 50+, Friendship only. One click
  fills and saves the identity, community-profile and age settings; every field stays editable.
  The gender list and the declaration are never changed by a preset.
- **Who may join**: a minimum age (18–99, never below 18), an optional maximum, optional genders
  (none ticked: everyone) and an optional declaration (up to 300 characters) every new member
  confirms; when they confirmed is stored. Checked when a profile is created; someone outside the
  rules is told plainly and not suspended (another community may fit). Members already in keep
  their place. ⚖️ Restricting membership by age, gender or belief may not be lawful for every
  community or country: check before you do.

## 8. Integrations (phase 24, admins only)

The **Integrations** page connects outside services: see [INTEGRATIONS.md](INTEGRATIONS.md).
Secrets can be replaced or removed but never read back; every change and test is in the audit log;
cards set by the server's `.env` are locked.

## 9. Known limitations

- No automated nudity detection yet: chat images are blurred until tapped, and reports cover the rest.
- Reports against an account are deleted when that account is deleted. A ban still blocks the email from signing up again ⚖️.
- The verified badge stays after profile photos change; re-verification is planned.
- Age-related suspensions have no appeal in the app (they come from the date of birth the member
  entered): publish a contact address for them.
