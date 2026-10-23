# Phase 24: Integrations in the dashboard (v1.0)

> Status: 🔨 building (2026-10-23). Approved: all four new groups; server environment variables win.
> 📘 = verify against official docs, ⚖️ = needs legal review.

Today every outside service is set with environment variables on the server, so an operator needs
SSH to change anything. This phase adds an **Integrations** section to the dashboard. In one place
it shows every outside service the app can use, lets admins connect and test it, and says what data
goes where.

## 24a. The Integrations page (the frame for everything below)

- **Admins only**, with the usual MFA. Moderators see nothing here.
- Grouped cards. Each card shows:
  - its status: not connected / connected / failing (last test, when) / **set by the server**
    (environment variables win and lock the card: nothing to do in the dashboard);
  - what it's for, what data it receives, and whether members must consent first;
  - a settings form, **Test connection**, and **Turn off**.
- **Secrets are write-only.** API keys and passwords are never sent back to the browser ("•••• set"
  plus *Replace* and *Remove*). They're stored encrypted (AES-256-GCM) with a key from a new
  `INTEGRATIONS_KEY` (32 random bytes; the installer creates it). Without that key the page is
  read-only and says why.
- **Every change is in the audit log** (which integration, which fields; never the values).
- **Changes apply without a restart** where possible (a cached config, refreshed on save). Sign-in
  providers need a restart of the API, and the card says so 📘.
- **Outgoing requests are guarded (SSRF):** https only (http allowed only for hosts on the server's
  own network when the operator sets `INTEGRATIONS_ALLOW_PRIVATE=true`, for Ollama and the like),
  no redirects to other hosts, short timeouts.

## 24b. What can be connected

| Group                      | Integration                                                                                   | Status today | What it does                                                                                             | Data that leaves the server                                          | Consent           |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| **Email**                  | SMTP, with presets for Postmark, Amazon SES, Mailgun, SendGrid, Brevo                         | env only     | Sign-in links, alerts, waitlist mail                                                                     | Email address and the message                                        | No (needed)       |
| **Sign-in**                | Google, Apple                                                                                 | env only     | "Continue with Google / Apple"                                                                           | Nothing until a member uses it                                       | No                |
| **Bot protection**         | Cloudflare Turnstile, hCaptcha                                                                | new          | A check on sign-in, the waitlist and friends' takes, against mass sign-ups                              | The visitor's IP and browser signals, to the provider                | No (security) ⚖️ |
| **AI**                     | Local model (Ollama), any OpenAI-compatible endpoint                                          | env only     | Icebreakers, bio drafts, the matchmaker's free text                                                      | As in [AI.md](../AI.md); external only with the member's `ai_cloud` | Yes (external)    |
| **Video**                  | LiveKit (self-hosted or cloud)                                                                | env only     | Video dates and speed dating                                                                             | End-to-end encrypted media it can't read                             | No                |
| **Push notifications**     | Expo push (an optional access token)                                                          | built in     | "New message" and "It's a match"                                                                         | Device token and a content-free text                                 | Yes (already)     |
| **Error monitoring**       | Sentry, or any Sentry-compatible server (GlitchTip)                                            | new          | Crashes and errors from the API, the worker and the web app                                              | Stack traces with personal data scrubbed (no bodies, cookies, ids)   | No ⚖️             |
| **Analytics**              | Plausible, Umami, Matomo (privacy-friendly; self-hostable)                                    | new          | Page counts for the operator                                                                             | Page path and browser info; **loaded only after `analytics` consent** | Yes               |
| **Team alerts**            | Slack, Discord, Telegram, Microsoft Teams                                                     | new          | "New urgent report", "New waitlist request", "Daily summary"                                            | Counts and a link to the dashboard: **never names, messages or photos** | No                |
| **Webhooks**               | Any URL (n8n, Make, Zapier, your own system)                                                  | new          | Chosen events, signed with HMAC-SHA256, with retries                                                     | Event type, time and opaque ids only                                 | No ⚖️             |
| **Storage and antivirus**  | S3 (or SeaweedFS), ClamAV                                                                     | env only     | Shown with health checks; **changed only on the server**: moving storage live could lose photos         | Files, if S3 is external                                             | No                |

**Left out on purpose** (each would send sensitive data to a third party or change what the app is):
ID and face verification services (biometrics), automatic photo moderation by an outside API, ad
networks and marketing pixels, payment providers (the app is free; donations stay a link). They can
be added later as separate decisions.

## API (new)

| Method and path                                  | Who   | What                                                                     |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------ |
| `GET /v1/admin/integrations`                     | admin | Every integration: status, public settings, which secrets are set        |
| `PUT /v1/admin/integrations/:id`                 | admin | Settings and secrets (omitted secret = unchanged, `null` = remove)       |
| `POST /v1/admin/integrations/:id/test`           | admin | Test the connection; the result is stored and audited                   |
| `DELETE /v1/admin/integrations/:id`              | admin | Turn off and remove the settings                                         |
| `GET /v1/admin/webhooks/deliveries`              | admin | The last 100 deliveries (status, time, event type; no payloads kept)    |
| `GET /v1/instance` (existing)                    | public| Adds only what clients need: the CAPTCHA site key, the analytics script |

## Data (new)

- `integrations`: id, enabled, public settings (JSON), encrypted secrets (JSON of AES-GCM blobs),
  last test (ok/error, a short reason, when), updated by, updated at.
- `webhook_deliveries`: event type, status code, attempt, time. Deleted after 30 days.

## Security and privacy

- Threat model: a stolen admin session (MFA, audit, secrets never readable back), a dashboard XSS
  (no secrets in the browser), SSRF through a URL field (allow-list rules above), a leaked database
  (secrets encrypted with a key that isn't in the database), noisy third parties (data minimisation
  per card, consent where needed).
- Each card's data line goes into PRIVACY.md's processors table automatically: the page and the
  docs say the same thing ⚖️.

## Order of work

1. 24a: the frame, encryption, audit, and moving today's integrations (email, sign-in, AI, video,
   push, storage health) onto it, with env still winning.
2. Bot protection, error monitoring, analytics (with the consent banner), team alerts, webhooks.
3. Tests: encryption, secrets never returned, SSRF rules, env precedence, each test button with
   fakes; e2e of the page in English and Hebrew with screenshots; docs.
