# Moderation guide for instance operators

Every Dateos instance needs people who handle reports. This guide covers staff roles, two-factor
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
pnpm --filter @dateos/api staff grant moderator@example.org moderator
pnpm --filter @dateos/api staff grant you@example.org admin
pnpm --filter @dateos/api staff list
pnpm --filter @dateos/api staff revoke former@example.org      # also removes their 2FA
pnpm --filter @dateos/api staff reset-mfa lost-phone@example.org
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
pnpm --filter @dateos/admin build            # VITE_API_URL=https://api.example.org for production
pnpm --filter @dateos/admin preview          # local preview on http://127.0.0.1:5174 with security headers
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
  root * /srv/dateos-admin
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

| Action  | Effect on the member                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Dismiss | None. The report is closed                                                                                                            |
| Warn    | The app shows a warning naming the category. Your internal note is never shown                                                        |
| Suspend | Signed out, all chats closed, hidden everywhere. Their other open reports are settled. They can still sign in to delete their account |
| Ban     | Like suspend, plus a keyed hash of the email (case, `+tags` and Gmail dots normalised) blocks new sign-ups. Admins only               |

Admins can lift a suspension or ban from the report page (with a reason). Suspensions for age are
never lifted from the dashboard.

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
| Verification records       | 24 months (the selfie itself: until decided) |
| Unfinished verifications   | 7 days                                       |
| Banned-email hashes        | Until the ban is lifted                      |

The worker deletes expired records daily (`cleanup-discovery` job). Constants are in
`packages/shared/src/moderation.ts`.

## 7. Known limitations

- No automated nudity detection yet: chat images are blurred until tapped, and reports cover the rest.
- Reports against an account are deleted when that account is deleted. A ban still blocks the email from signing up again ⚖️.
- The verified badge stays after profile photos change; re-verification is planned.
- No appeal workflow inside the app yet: publish a contact address for appeals.
