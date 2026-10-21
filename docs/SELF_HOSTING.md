# Run your own Dateos

From an empty server to a live, branded dating site in about 15 minutes. Everything is free and
open source; you own the server and the data.

> ⚖️ Running an instance makes you the operator (data controller) of your members' data. Before you
> open it to the public, have the privacy policy, terms of use, accessibility statement and your
> moderation process reviewed by a lawyer for your jurisdiction. Nothing in this repository is a
> statement of legal compliance.

## What you need

|          | Minimum                                      | Notes                                                                         |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| Server   | 2 vCPU, 4 GB RAM, 40 GB disk (Linux, x86-64) | +4 GB RAM for the optional local AI (Ollama). ClamAV alone needs about 1.5 GB |
| Domain   | One domain or subdomain you control          | Three DNS names: `example.org`, `admin.example.org`, `api.example.org`        |
| Email    | Any SMTP provider                            | Sign-in links are sent by email                                               |
| Software | Docker with Compose v2, `git`, `openssl`     | Node is **not** needed on the server                                          |

## 1. Install

```bash
git clone https://github.com/diamondrubinny/dateos.git && cd dateos
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
head -c 32 /dev/urandom | base64 > /root/.dateos-backup-key && chmod 600 /root/.dateos-backup-key
# crontab -e
0 3 * * * cd /opt/dateos && BACKUP_PASSPHRASE_FILE=/root/.dateos-backup-key ./scripts/backup.sh
```

Copy the encrypted files off the server and keep the passphrase (and `.env`) somewhere else. Test a
restore regularly, into a separate database first:

```bash
RESTORE_DATABASE=dateos_check BACKUP_PASSPHRASE_FILE=/root/.dateos-backup-key \
  ./scripts/restore.sh backups/dateos-db-<time>.dump.enc
```

Deleted accounts are still present in old backups until those expire; after restoring an old backup,
delete again the accounts that were deleted since. Document your backup retention ⚖️.

## Updates

```bash
git pull
docker compose -f infra/docker-compose.yml --env-file .env --profile app --profile full up -d --build
```

Database migrations run automatically when the API starts (`MIGRATE_ON_START=true`). If you run
several API replicas, set it to `false` and run `pnpm --filter @dateos/db db:migrate` once instead.

## Push notifications (optional)

Notifications are off by default. To enable them: build the app with your own Expo (EAS) project
(`extra.eas.projectId` in `apps/mobile/app.json`), set `PUSH_PROVIDER=expo` (and optionally
`EXPO_ACCESS_TOKEN`) in `.env`, and restart the worker. Members turn them on per device in Settings.
Notifications never contain names or message text, only "You have a new message" or "It's a match",
but they still pass through Expo, Apple and Google: mention this in your privacy policy ⚖️.

## Mobile apps

The web app works on phones and can be added to the home screen. Native iOS and Android builds come
from `apps/mobile` with Expo (EAS): set `EXPO_PUBLIC_API_URL=https://api.example.org`, your own app
name, bundle id and icons, then submit with your own developer accounts. 📘 Follow the current Expo and
store documentation; dating apps get extra review on both stores.

Sign-in links open the app through its scheme (`APP_SCHEME`, `dateos` by default). The session is
never put in that link: the app proves it started the sign-in (PKCE) and exchanges a one-time code, so
another app that registers the same scheme gets nothing usable. Sign-in therefore needs your own build
(it does not work in Expo Go).

## Test the whole setup locally

`e2e/instance.ts` runs the full first-run flow in a real browser against the production web server
configuration (Caddy with local certificates for `dateos.test`): claim, TOTP, branding, logo upload,
and the branded member app in light and dark mode, plus an axe-core accessibility audit. See the
comment at the top of the file for the environment it expects.
