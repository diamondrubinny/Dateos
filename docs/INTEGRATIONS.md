# Integrations

The dashboard's **Integrations** page (admins only) connects the outside services your community
uses. Each card says what it's for and exactly what it sends. This page explains how it works and
how to set up each one.

> ⚖️ Every service you connect is a processor or recipient of personal data. List it in your privacy
> policy (the [data map](PRIVACY.md) helps) and sign a data processing agreement where needed.

## How it works

- **The server's environment wins.** If `.env` sets an integration (for example `SMTP_HOST`), its card
  is locked and shows "Set on the server". Remove the variable and restart to manage it in the
  dashboard instead.
- **Secrets are write-only.** API keys, passwords and webhook addresses are encrypted (AES-256-GCM)
  with `INTEGRATIONS_KEY`, which is not in the database. The dashboard only ever shows "stored".
  `install.sh` creates the key; on an older install add one: `openssl rand -hex 32`, the same value
  for the API and the worker.
- **Changes apply at once** (within about 10 seconds), except sign-in with Google or Apple, which
  apply when the API restarts.
- **Every change and every test is in the audit log**: which integration and which fields, never the
  values.
- **Addresses are checked** before anything is sent (SSRF protection): `https://` only, no
  passwords in addresses, no redirects, and no private networks (`10.x`, `192.168.x`, `localhost`,
  cloud metadata…) unless you set `INTEGRATIONS_ALLOW_PRIVATE=true`, for example for Ollama or a
  self-hosted Matomo on the same server.
- **Test connection** checks each integration for real (a test message, a test event, the API
  credentials) and records the result on the card.

## The integrations

| Card                | Use it for                                              | Set up                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email (SMTP)        | Sign-in links, check-in alerts, waitlist mail           | Choose a provider (Postmark, Amazon SES, Mailgun, SendGrid, Brevo) to fill in the server. Keep `SMTP_HOST` in `.env` until an admin has signed in: the first sign-in needs email.                                                                           |
| Sign in with Google | "Continue with Google"                                  | Create an OAuth client 📘; redirect URI `https://api.<domain>/v1/auth/callback/google`. Restart the API.                                                                                                                                                    |
| Sign in with Apple  | "Continue with Apple"                                   | Create a Services ID and a client secret 📘. Restart the API.                                                                                                                                                                                               |
| Bot protection      | Sign-in links, the waitlist, friends' takes             | Cloudflare Turnstile or hCaptcha: a site key and a secret key. Add the host the card shows to `CSP_EXTRA_HOSTS` and restart the web server.                                                                                                                 |
| AI model            | Icebreakers, bio drafts, the matchmaker's free text     | Ollama on your server (needs `INTEGRATIONS_ALLOW_PRIVATE=true` for a local address) or any OpenAI-compatible endpoint. An external one is used only for members who allowed it. See [AI.md](AI.md).                                                         |
| Video (LiveKit)     | Video dates and speed dating                            | The public `wss://` address, the API key and the secret. Admins still turn calls on in Branding.                                                                                                                                                            |
| Push notifications  | New messages and matches                                | Turn it on; an Expo access token is optional. Needs your own EAS build.                                                                                                                                                                                     |
| Error monitoring    | Crashes in the API, the worker and the web app          | A Sentry or GlitchTip DSN. Web errors go to your server first, which scrubs them and forwards them: the browser never talks to Sentry.                                                                                                                      |
| Analytics           | Visit counts                                            | Plausible, Umami or Matomo (cloud or self-hosted): the address and the site id. Loaded only in the web app, only for signed-in members who allowed analytics, with page patterns (`/profile/[id]`) instead of addresses. Add the host to `CSP_EXTRA_HOSTS`. |
| Team alerts         | Urgent reports, the waitlist, a morning summary (08:00) | Slack or Discord or Teams (an incoming webhook address), or Telegram (a bot token and a chat id). Counts and a dashboard link only.                                                                                                                         |
| Webhooks            | n8n, Make, Zapier, your own systems                     | An `https://` address and a signing secret; choose the events. See below.                                                                                                                                                                                   |
| Storage, Antivirus  | Photos and voice; scanning uploads                      | Set on the server only (`S3_*`, `CLAMAV_*`): moving storage live could lose files. The card checks that they answer.                                                                                                                                        |

Left out on purpose: identity and face verification services, outside photo moderation, ad
networks and pixels, payments. Each would send sensitive data elsewhere or change what the app is.

## Webhooks

Each delivery is a `POST` with JSON:

```json
{
  "id": "3b0f…",
  "type": "member.joined",
  "occurredAt": "2026-10-23T08:00:00.000Z",
  "data": { "memberId": "…" }
}
```

Events: `member.joined`, `member.deleted`, `report.created`, `report.resolved`, `match.created`
(the match id only, never who matched), `event.created`. Ids only: look up anything else through
your own access, if you have it.

**Check the signature** in `X-NexaHeart-Signature: t=<unix seconds>,v1=<hex>`: compute
`HMAC-SHA256(secret, "<t>.<raw body>")`, compare in constant time, and refuse old timestamps
(for example older than 5 minutes):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody, maxAgeSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > maxAgeSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Failed deliveries are retried 5 times with growing delays. The card lists the last 100 attempts
(event, answer, attempt, time; no payloads), kept for 30 days.

## Content-Security-Policy

The web app only runs scripts from its own address. A CAPTCHA or analytics needs its host added:

```sh
CSP_EXTRA_HOSTS=https://challenges.cloudflare.com https://plausible.io
```

Then `docker compose … up -d web` to restart the web server. The card shows the exact hosts.
