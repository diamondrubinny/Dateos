# Run your own NexaHeart

New to servers? Follow the step-by-step [installation guide](INSTALL.md) ([עברית](INSTALL.he.md)),
with checks after each step, troubleshooting, and questions and answers.

From an empty server to a live, branded dating site in about 15 minutes. Everything is free and
open source; you own the server and the data.

> ⚖️ Running an instance makes you the operator (data controller) of your members' data. Before you
> open it to the public, have the privacy policy, terms of use, accessibility statement and your
> moderation process reviewed by a lawyer for your jurisdiction. Nothing in this repository is a
> statement of legal compliance.

## What you need

|          | Minimum                                      | Notes                                                                                                                        |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Server   | 2 vCPU, 4 GB RAM, 40 GB disk (Linux, x86-64) | +4 GB RAM for the optional local AI (Ollama). ClamAV alone needs about 1.5 GB; voice transcripts about 0.5 GB while they run |
| Domain   | One domain or subdomain you control          | Three DNS names: `example.org`, `admin.example.org`, `api.example.org`                                                       |
| Email    | Any SMTP provider                            | Sign-in links are sent by email                                                                                              |
| Software | Docker with Compose v2, `git`, `openssl`     | Node is **not** needed on the server                                                                                         |

## Quick install (one command)

On a fresh server whose three DNS names already point at it, as root over SSH:

```bash
ssh root@YOUR_SERVER_IP 'curl -fsSL https://raw.githubusercontent.com/diamondrubinny/NexaHeart/main/scripts/bootstrap.sh | DOMAIN=example.org SMTP_HOST=smtp.your-provider.example SMTP_USER=you@example.org SMTP_PASSWORD=your-smtp-password bash'
```

It runs [`scripts/bootstrap.sh`](../scripts/bootstrap.sh): installs Docker and git if needed, clones
into `/opt/nexaheart`, runs `install.sh`, writes the SMTP settings, opens 80/443 in `ufw`, builds and
starts the `app` and `full` profiles, waits for `/ready`, sets up an encrypted daily backup
(`/etc/cron.d/nexaheart-backup`) and prints the setup token. Run it again to update. Then claim the
instance (step 4). Steps 1 to 3 below are the same thing by hand.

## 1. Install

```bash
git clone https://github.com/diamondrubinny/NexaHeart.git nexaheart && cd nexaheart
./install.sh --domain example.org
```

The installer generates every secret (database, Redis, object storage, auth), writes `.env`
(readable only by you), and prints a **one-time setup token**. Keep the token: you need it in step 4.

Then edit `.env` and set your SMTP provider:

```bash
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM="Your Community <no-reply@example.org>"
```

## 2. DNS and firewall

Create `A`/`AAAA` records for `example.org`, `admin.example.org` and `api.example.org` that point at the
server. Open ports **80** and **443** (TCP, and UDP 443 for HTTP/3). Keep everything else closed:
the database, Redis, storage and ClamAV listen only on `127.0.0.1`.

## 3. Start

```bash
docker compose -f infra/docker-compose.yml --env-file .env --profile app --profile full up -d --build
```

| Profile  | Starts                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| (always) | PostgreSQL + PostGIS + pgvector, Redis, SeaweedFS (S3)                                                                                   |
| `full`   | ClamAV malware scanning. Required with the default `MALWARE_SCAN=clamav`; switching it off (`MALWARE_SCAN=disabled`) is for testing only |
| `app`    | API, worker, and the web server (Caddy): the member app, the dashboard and the API over HTTPS                                            |
| `ai`     | Optional local AI (Ollama) for semantic matching and icebreakers                                                                         |

Caddy requests certificates from Let's Encrypt automatically once DNS points at the server. The first
start takes a few minutes (image builds, ClamAV signature download).

Check: `https://api.example.org/ready` should report every dependency as `up`.

## 4. Claim your instance

1. Open `https://admin.example.org` and sign in with your email (the link arrives by email).
2. Enter the setup token from step 1. You become the first admin. The token stops working as soon as
   an admin exists. (No token? `docker compose ... exec api node dist/cli/staff.js grant you@example.org admin`.)
3. Set up two-factor authentication with an authenticator app (mandatory for staff).
4. Brand your instance: name, tagline, color (checked for readable contrast), language, the operator's
   name and contact email (shown in the legal pages and the accessibility statement), an optional
   donation link and a logo.

Your community app is now live at `https://example.org`. Invite moderators: they sign in once, then
`docker compose ... exec api node dist/cli/staff.js grant them@example.org moderator` (see [ADMIN.md](ADMIN.md)).

## 5. Before you open the doors

- [ ] Adapt the drafts in [`docs/legal/`](legal/) and the in-app summaries (`apps/mobile/src/i18n/*.ts`, `legal.*`), have them reviewed ⚖️
- [ ] Go through [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) and [PRIVACY.md](PRIVACY.md)
- [ ] Publish a contact address for privacy, accessibility and moderation appeals
- [ ] Decide on retention periods (defaults in [ADMIN.md](ADMIN.md#6-retention-defaults-need-legal-review-)) ⚖️
- [ ] Turn on full-disk or volume encryption on the server
- [ ] Set up backups (below) and test a restore
- [ ] Restrict `admin.example.org` (VPN or IP allowlist in `infra/web/Caddyfile`) if you can
- [ ] Run an accessibility review with real users of assistive technology

## Backups

`scripts/backup.sh` saves the database and all stored files, encrypted when you give it a passphrase
file, and deletes local backups older than 14 days (`BACKUP_KEEP_DAYS`). Run it daily, e.g. from cron:

```bash
head -c 32 /dev/urandom | base64 > /root/.nexaheart-backup-key && chmod 600 /root/.nexaheart-backup-key
# crontab -e
0 3 * * * cd /opt/nexaheart && BACKUP_PASSPHRASE_FILE=/root/.nexaheart-backup-key ./scripts/backup.sh
```

Copy the encrypted files off the server and keep the passphrase (and `.env`) somewhere else. Test a
restore regularly, into a separate database first:

```bash
RESTORE_DATABASE=nexaheart_check BACKUP_PASSPHRASE_FILE=/root/.nexaheart-backup-key \
  ./scripts/restore.sh backups/nexaheart-db-<time>.dump.enc
```

Deleted accounts are still present in old backups until those expire; after restoring an old backup,
delete again the accounts that were deleted since. Document your backup retention ⚖️.

## Updates

```bash
git pull
docker compose -f infra/docker-compose.yml --env-file .env --profile app --profile full up -d --build
```

Database migrations run automatically when the API starts (`MIGRATE_ON_START=true`). If you run
several API replicas, set it to `false` and run `pnpm --filter @nexaheart/db db:migrate` once instead.

**Updating from before phase 24?** Add `INTEGRATIONS_KEY` to `.env` (`openssl rand -hex 32`) so
admins can save settings in the dashboard's Integrations page. Variables already in your `.env`
(SMTP, AI, push, LiveKit) keep working and lock their cards; remove one to manage it in the
dashboard instead.

**Updating from before phase 26?** Voice messages get a "Show text" button. The worker downloads
an open speech model (about 77 MB, from Hugging Face) the first time someone asks, and keeps it in
the `models-data` volume. Set `TRANSCRIPTS=off` in `.env` to turn this off, or see below.

## Communities that connect (optional)

Two NexaHeart communities can connect so that members who choose to can be seen, and match, in
both, and chat (text) with their matches there. Turn it on with `FEDERATION=on` (it needs `INTEGRATIONS_KEY`) and restart the API; admins
then use **Partners** in the dashboard.

- The server publishes its name, address and public key at `https://api.<domain>/.well-known/nexaheart`.
- Every request between servers is signed (Ed25519), dated (5 minutes either way) and can't be
  replayed. Outgoing requests use the same guard as the integrations: https only, no private
  networks (set `INTEGRATIONS_ALLOW_PRIVATE=true` only to test two servers on one machine).
- Members take part only after they join in the app. A partner receives their card (first name,
  age, gender, intention, bio, prompts, photo ids, languages, verified) under a random code name per
  partner; photos are served through the member's own server, never copied. Never: email,
  location, religion, accessibility needs, voice, messages or reports.
- The signing key can be replaced from the dashboard without ending partnerships (partners are
  told with the old key). Changing `INTEGRATIONS_KEY` makes the stored key unreadable: replace
  the signing key first, or renew every partnership.
- Reports about your members from a partner land in your own moderation queue; deletions and
  reports that can't reach a partner are retried by the API for 7 days (no extra service needed).
- ⚖️ The two operators share responsibility for what members share: sign a data-sharing agreement
  first. The dashboard asks both admins to confirm it.

## Voice transcripts

"Show text" under each voice message and voice prompt is made by Whisper, an open speech model, in
the **worker on your server**: the voice never goes anywhere else. Nothing is transcribed until
someone who may play the clip asks (members who shared "deaf or hard of hearing" get it by
themselves), and a speaker can choose "voice only" in Settings.

- **CPU:** about 2 seconds for 10 seconds of speech on one core, one clip at a time.
- **Better Hebrew and Arabic:** `TRANSCRIPTS_MODEL=onnx-community/whisper-small` (about 250 MB, about
  three times slower) 📘.
- **Offline servers:** copy the model files into the volume (`TRANSCRIPTS_CACHE`, `/models` in
  Docker) under the model's name; nothing is downloaded then.
- **Off:** `TRANSCRIPTS=off` for both the API and the worker hides the button everywhere.

## Integrations (optional)

Admins connect outside services in the dashboard: **Integrations** (email, sign-in providers, a
CAPTCHA, the AI model, video, push, error monitoring, analytics, team alerts and webhooks). See
[INTEGRATIONS.md](INTEGRATIONS.md) for each one, the webhook signature and `CSP_EXTRA_HOSTS`.

## Push notifications (optional)

Notifications are off by default. To enable them: build the app with your own Expo (EAS) project
(`extra.eas.projectId` in `apps/mobile/app.json`), then turn on **Push notifications** in the
dashboard's Integrations page (or set `PUSH_PROVIDER=expo` and optionally `EXPO_ACCESS_TOKEN` in
`.env` and restart the worker). Members turn them on per device in Settings.
Notifications never contain names or message text, only "You have a new message" or "It's a match",
but they still pass through Expo, Apple and Google: mention this in your privacy policy ⚖️.

## Video dates (optional)

Members who matched can have a video or voice-only call in the app. Calls go through
[LiveKit](https://livekit.io) (Apache-2.0) on your own server and are **end-to-end encrypted**: the
two devices agree on the key, so the server forwards audio, video and captions it can't read. Nothing
is recorded or stored, and members never see each other's IP addresses. Very old browsers without
support for encrypted calls are asked to use the app or an up-to-date browser.

1. Run the installer with `--video` (or add the values by hand): it sets `LIVEKIT_URL=wss://rtc.<domain>`
   and `RTC_DOMAIN=rtc.<domain>` in `.env` and writes `infra/data/livekit/livekit.yaml` with the
   generated `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. The config turns off automatic room creation (only
   the API creates rooms, so an old join token can't reopen a call) and limits rooms to two people.
   **On a server that is already running** (never re-run the installer with `--force` there: it
   replaces every secret), add the values by hand. In `.env`: `LIVEKIT_URL=wss://rtc.<domain>`,
   `RTC_DOMAIN=rtc.<domain>`, `LIVEKIT_API_KEY=API` followed by 12 random letters, and
   `LIVEKIT_API_SECRET=` 48 random letters (`openssl rand -base64 48 | tr -d '/+=' | cut -c1-48`).
   Then create `infra/data/livekit/livekit.yaml` with the same content the installer writes (see the
   LiveKit section of `install.sh`), using your key and secret, and `chmod 644` it.
2. DNS: point `rtc.<domain>` at the server. Firewall: open **TCP 7881** and **UDP 7882** (audio and
   video); signalling goes through Caddy on 443.
3. Start with `--profile video` added to your usual `docker compose ... up -d` command.
4. In the dashboard: **Branding → Video dates**, turn them on and choose the maximum length
   (default 60 minutes).

Bandwidth: a 1:1 video call uses roughly 1–3 GB of server traffic per hour. Strict networks that block
UDP fall back to TCP 7881; for networks that only allow HTTPS, LiveKit's TURN over TLS can be added
(certificate needed) 📘 https://docs.livekit.io/home/self-hosting/. Using a hosted LiveKit instead
works too (point `LIVEKIT_URL` at it), but then a third party carries the calls: DPA and international
transfers ⚖️. Mention video calls in your privacy policy (the drafts in `docs/legal` already do) ⚖️.

## Who can join (optional)

In the dashboard, **Joining** sets how new people open an account:

- **Open**, the default: anyone with an email address.
- **Invite code**: an admin makes codes (with a number of uses and an expiry). Optionally, verified
  members can each invite up to 3 people. Someone without a code who asks for a sign-in link gets an
  email explaining how to join instead.
- **Waitlist**: people leave their address (and a short note), and a moderator approves them; the
  approval email lets them open an account within 7 days.

People who already have an account keep signing in as usual. Staff accounts are new accounts too: in
invite or waitlist mode, give a new staff member a code (or approve them) before they first sign in.

## Passkeys

Members can add a passkey in Settings and sign in with it on the web. The passkey belongs to the web
app's domain: set `PUBLIC_APP_URL` (for example `https://app.example.org`) if it isn't the first
entry of `CORS_ORIGINS`. Changing that domain later makes existing passkeys unusable (members sign in
with an email link and add a new one). Passkeys in the native apps need Associated Domains (iOS) and
Digital Asset Links (Android) for your domain 📘.

## Mobile apps

The web app works on phones and can be added to the home screen. Native iOS and Android builds come
from `apps/mobile` with Expo (EAS): set `EXPO_PUBLIC_API_URL=https://api.example.org`, your own app
name, bundle id and icons, then submit with your own developer accounts. 📘 Follow the current Expo and
store documentation; dating apps get extra review on both stores.

Sign-in links open the app through its scheme (`APP_SCHEME`, `nexaheart` by default). The session is
never put in that link: the app proves it started the sign-in (PKCE) and exchanges a one-time code, so
another app that registers the same scheme gets nothing usable. Sign-in therefore needs your own build
(it does not work in Expo Go).

## Test the whole setup locally

`e2e/instance.ts` runs the full first-run flow in a real browser against the production web server
configuration (Caddy with local certificates for `nexaheart.test`): claim, TOTP, branding, logo upload,
and the branded member app in light and dark mode, plus an axe-core accessibility audit. See the
comment at the top of the file for the environment it expects.

## License and the "Powered by NexaHeart" credit

NexaHeart is licensed under the AGPL-3.0-or-later with the additional terms in [NOTICE](../NOTICE).
Your community keeps its own name, logo and colours; the app, the dashboard and the emails also show
a small "Powered by NexaHeart · Open source" credit, which must stay. If you change the code and run
it for others, publish your version's source and set `SOURCE_CODE_URL` in `.env` to it, so the
"Open source" link points there (AGPL section 13) ⚖️.
