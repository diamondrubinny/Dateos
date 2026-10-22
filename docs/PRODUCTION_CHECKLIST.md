# Production checklist

> Go through this before opening an instance to the public. ✅ = covered by the software and its
> automated tests (re-run them on your server), ☐ = something you must do or decide.
> ⚖️ lawyer / privacy officer · ♿ accessibility consultant · 🔍 penetration tester · 📘 check official docs.
> Passing this list does not make an instance compliant or secure by itself.

## 1. Functional

- ✅ Sign-in by email link (web and native), onboarding (consents → profile → photos → prompts →
  location), discovery, likes, matches, chat, voice messages, reports, verification, Settings:
  `pnpm --dir e2e screenshots|chat|safety|voice|coach|privacy|a11y`.
- ☐ Run the end-to-end suites against your own domain (`WEB_URL`, `API_URL`).
- ☐ Test the native apps on real iPhone and Android devices: sign-in link opens the app, notifications,
  "Download my data" share sheet, voice recording 📘.
- ☐ Video dates (if enabled): `pnpm --dir e2e calls` against your domain, then a real call between an
  iPhone and an Android phone on mobile data (camera and microphone permissions, switching cameras,
  speaker vs earpiece, the app in the background, a lost connection) 📘. Check that TCP 7881 and UDP 7882
  are reachable from outside.

## 2. Roles and permissions

- ✅ Members, moderators and admins are checked on the server for every request; moderators can't act
  on staff or on reports about themselves; staff need TOTP every 12 hours (`safety.test.ts`, `admin`).
- ✅ The setup token works once, ever (`instance.test.ts`).
- ☐ Grant staff roles only with `pnpm --filter @nexaheart/api staff grant …`; keep at least two admins.
- ☐ Review the audit log (dashboard → Audit) weekly.

## 3. Sign-in and sessions

- ✅ Magic links: single use, 10 minutes, stored hashed; limits per IP, per address and per address+IP;
  no account enumeration (`me.test.ts`).
- ✅ Native sign-in uses a PKCE code exchange; the session never travels in a URL
  (`native-signin.test.ts`).
- ✅ HttpOnly, Secure (on HTTPS), SameSite=Lax cookies; 30-day sessions; sign-out and suspension also
  close live WebSocket connections (`chat.test.ts`).
- ☐ `AUTH_SECRET` is long and random (`install.sh` generates it); rotating it signs everyone out.

## 4. Input, API and uploads

- ✅ Every body, query and parameter is validated (zod) with size limits; unknown fields are rejected on
  sensitive routes; parameterised SQL only.
- ✅ Errors never include stack traces or internal details; request ids for support.
- ✅ CORS allowlist, strict CSP, HSTS, `frame-ancestors 'none'`, no-referrer.
- ✅ Uploads: type by magic bytes, size and pixel limits, quarantine bucket, re-encoding (images with
  sharp, voice with ffmpeg without a shell), metadata (GPS) removed, served only through access checks.
- ☐ `CORS_ORIGINS` lists only your web and admin origins; `TRUST_PROXY=true` only behind Caddy (or list
  your proxy's IP).

## 5. Malware scanning

- ✅ ClamAV scans every upload before processing; failures are retried, never treated as clean.
- ☐ Run with `--profile full` (ClamAV) and `MALWARE_SCAN=clamav`; check that signatures update
  (`docker compose logs clamav`).

## 6. Secrets and environment

- ✅ No secrets in the repository (Gitleaks in CI); `.env.example` has placeholders only; logs redact
  cookies, tokens and email addresses.
- ☐ `.env` readable only by root (`chmod 600 .env`); `SETUP_TOKEN` removed after the claim.
- ☐ Different passwords for PostgreSQL, Redis and object storage; nothing exposed except ports 80/443.

## 7. Dependencies

- ✅ CI: `pnpm audit --prod` (fails on high/critical; reviewed exceptions in
  [SECURITY_REVIEW.md](SECURITY_REVIEW.md)), CodeQL, pinned GitHub Actions.
- ☐ Rebuild images monthly (base images, ffmpeg, ClamAV) and re-run the audit.

## 8. Backups and restore

- ✅ `scripts/backup.sh` (database + files, AES-256 encrypted with `BACKUP_PASSPHRASE_FILE`, old backups
  deleted after `BACKUP_KEEP_DAYS`); `scripts/restore.sh` (restore into a test database first). The round
  trip was tested: same rows, same migration history.
- ☐ Daily cron job; copy encrypted backups off the server; keep the passphrase separately.
- ☐ Test a restore every quarter. Remember that restoring an old backup can bring back deleted
  accounts: delete them again after a restore ⚖️.

## 9. Personal data

| Data                     | Purpose       | Legal basis (suggested)   | Stored                     | Kept for                   | Third parties       |
| ------------------------ | ------------- | ------------------------- | -------------------------- | -------------------------- | ------------------- |
| Email                    | Sign-in       | Contract                  | PostgreSQL                 | Account lifetime           | Email provider      |
| Profile, photos, prompts | Profile       | Contract                  | PostgreSQL, object storage | Until changed / deleted    | Hosting             |
| Gender, interested in    | Matching      | Explicit consent (Art. 9) | PostgreSQL                 | Until withdrawn            | —                   |
| Approximate location     | Distance      | Consent                   | PostgreSQL (~1 km cell)    | Until removed              | —                   |
| Messages, chat media     | Chat          | Contract                  | PostgreSQL, object storage | Match + 30 days            | —                   |
| Reports, evidence        | Safety        | Legitimate interest       | PostgreSQL, object storage | 12 months after resolution | —                   |
| Verification selfie      | Badge         | Consent                   | Object storage             | Until decided              | —                   |
| Push token               | Notifications | Consent                   | PostgreSQL                 | Until opt-out              | Expo, Apple, Google |
| Audit and server logs    | Security      | Legitimate interest       | PostgreSQL, Docker logs    | 24 months / ~50 MB         | —                   |

Full inventory: [PRIVACY.md](PRIVACY.md). ☐ Confirm each legal basis ⚖️.

## 10. Cookies and trackers

- ✅ Web: one HttpOnly session cookie and one language preference; native: keychain items only. No
  analytics, advertising or third-party requests; the privacy e2e compares the real browser with the
  published list and fails on any outside request.
- ✅ No banner needed for strictly necessary storage; the "Privacy & cookies" page is linked from the
  welcome screen and Settings ⚖️.
- ☐ If you add any analytics or embeds: gate them behind the `analytics` consent (off by default),
  list them in the inventory, cookie policy and Privacy & cookies page, and make withdrawal stop them.

## 11. Consent

- ✅ Required: terms, privacy policy, sensitive data (separate, unticked, explained). Optional: AI with an
  external provider, analytics (off by default). All versioned and changeable in Settings; withdrawal is
  effective at once (`consent.test.ts`).
- ☐ Bump `TERMS_VERSION` / `PRIVACY_VERSION` when you publish reviewed documents.

## 12. Legal documents ⚖️

- ☐ Privacy policy, terms of use, cookie policy: adapt the drafts in [`docs/legal/`](legal/) and have
  them reviewed; put the operator name and contact in the admin wizard.
- ☐ DPA with each provider; DPIA ([PRIVACY.md §6](PRIVACY.md)); Israeli registration / privacy officer
  questions ([§7](PRIVACY.md)); EU representative if needed.

## 13. Accessibility ♿

- ✅ axe-core WCAG 2.1 A/AA on every screen in the e2e suites: 0 violations; keyboard-only sign-in with
  visible focus, reflow at 320 px, 200% text, reduced motion, `lang`/`dir` (`pnpm --dir e2e a11y`).
- ☐ Manual review with VoiceOver, TalkBack and NVDA by an accessibility consultant; publish the
  accessibility statement ([draft](legal/accessibility-statement.en.md)) with a named coordinator.

## 14. Mobile, RTL, performance and SEO

- ✅ Hebrew right-to-left and English on every screen (screenshots in both).
- ✅ Load test: discovery p95 62 ms and sending p95 16 ms with 5 000 members ([PERFORMANCE.md](PERFORMANCE.md)).
- ☐ The web app is a signed-in product: keep `noindex` on the dashboard; add your own landing page with a
  title, description and Open Graph tags if you want search traffic.
- ☐ App Store / Play: privacy labels (data collected: email, photos, sensitive info, approximate
  location, messages; no tracking), age rating 17+/18+, account deletion inside the app (present) 📘.

## 15. Needs a professional

| Who                         | What                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lawyer / privacy officer ⚖️ | Legal bases, legal drafts, DPIA, Israeli database duties and privacy officer, EU representative, retention periods (bans, consents after deletion), transfers (push via US companies), incident duties |
| Accessibility consultant ♿ | Manual audit with assistive technology, accessibility statement                                                                                                                                        |
| Penetration tester 🔍       | External test of the API, WebSocket, uploads, admin, native sign-in and the LiveKit server (join tokens, webhooks) before a public launch ([internal review](SECURITY_REVIEW.md))                      |
