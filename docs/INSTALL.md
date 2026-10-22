# Install Dateos, step by step

**English** · [עברית](INSTALL.he.md)

This guide takes you from an empty server to a live dating app for your community, with your name,
your colours and your own moderation team. Plan about an hour the first time; most of it is waiting
for DNS and the first build. You don't need to be a developer: if you can connect to a server over
SSH and paste commands, you can do this.

> ⚖️ Running an instance makes you the operator (in privacy law, the data controller) of your
> members' data. Read step 8 before you invite anyone, and have the legal texts reviewed by a lawyer
> for your country. Nothing in this repository is a statement of legal compliance.

Already comfortable with Docker? [SELF_HOSTING.md](SELF_HOSTING.md) is the short reference version.

## What you'll have at the end

| Address                     | What it is                                              |
| --------------------------- | ------------------------------------------------------- |
| `https://example.org`       | The member app (works in any phone or computer browser) |
| `https://admin.example.org` | The moderation dashboard, for you and your moderators   |
| `https://api.example.org`   | The server the app talks to (members never open it)     |

Replace `example.org` with your own domain everywhere in this guide.

## Before you start

- [ ] **A server**: Linux (x86-64), at least 2 vCPU, 4 GB RAM and 40 GB disk. Any cloud provider's
      virtual server works. Add 4 GB of RAM if you want the optional local AI.
- [ ] **A domain** you control, where you can add DNS records (a subdomain like
      `dating.example.org` works too).
- [ ] **An email sending service** (SMTP): members sign in with a link sent by email, so this is
      required. Any transactional email provider, or your organisation's mail server.
- [ ] About an hour, and an email address for yourself (you become the first admin).

The software is free (MIT license). You pay only for the server, the domain and the email service.

## Step 1: Prepare the server

Connect to the server over SSH and install **Docker Engine with the Compose plugin**, plus `git` and
`openssl`, following Docker's official instructions for your Linux distribution 📘
(<https://docs.docker.com/engine/install/>). Node.js is **not** needed on the server.

✅ **Check:** both commands print a version.

```bash
docker --version
docker compose version
```

## Step 2: Point your domain at the server

In your domain's DNS settings, create three records that point at the server's public IP address
(`A` for IPv4, and `AAAA` too if the server has IPv6):

| Name                | Type     | Value            |
| ------------------- | -------- | ---------------- |
| `example.org`       | A (AAAA) | your server's IP |
| `admin.example.org` | A (AAAA) | your server's IP |
| `api.example.org`   | A (AAAA) | your server's IP |

In your provider's firewall, open ports **80** and **443** (TCP) and **443** (UDP). Keep every other
port closed: the database, Redis, file storage and the virus scanner only listen inside the server.

DNS changes can take from a few minutes to a few hours to spread.

✅ **Check:** `ping admin.example.org` (from your own computer) shows your server's IP.

## Step 3: Download Dateos and create the configuration

```bash
sudo mkdir -p /opt/dateos && sudo chown "$USER" /opt/dateos
git clone https://github.com/diamondrubinny/Dateos.git /opt/dateos
cd /opt/dateos
./install.sh --domain example.org
```

The installer:

- creates strong random passwords for the database, Redis, file storage and sign-in, and writes
  them to `.env` (readable only by you, never committed to git);
- sets the three addresses from your domain;
- prints a **one-time setup token**. Copy it somewhere safe: you need it in step 6. (It is also saved
  in `.env` as `SETUP_TOKEN`.)

✅ **Check:** `ls -l .env` shows `-rw-------` (only you can read it).

> Keep a copy of `.env` somewhere safe outside the server. Without it, backups can't be restored.

## Step 4: Connect your email service

Open `.env` (for example `nano .env`) and fill in the details your email provider gives you:

```bash
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASSWORD=your-password
SMTP_FROM="Your Community <no-reply@example.org>"
```

So that sign-in emails don't land in spam, set up SPF and DKIM for your domain as your email provider
explains 📘.

## Step 5: Start everything

To save typing, create a short alias (run it once per SSH session, or add it to `~/.bashrc`):

```bash
alias dc='docker compose -f /opt/dateos/infra/docker-compose.yml --env-file /opt/dateos/.env --profile app --profile full'
```

Then build and start:

```bash
cd /opt/dateos
dc up -d --build
```

The first start takes several minutes: the images are built, the virus scanner downloads its
signatures, and the web server requests HTTPS certificates from Let's Encrypt (this works only once
DNS from step 2 points at the server).

✅ **Check:**

```bash
dc ps                                   # every service "running" or "healthy"
curl https://api.example.org/ready      # {"status":"ready", ...} with every check "up"
```

Then open `https://example.org` in your browser: you should see the welcome screen.

## Step 6: Claim your instance and make it yours

1. Open `https://admin.example.org`, enter your email and click the sign-in link you receive.
2. Enter the **setup token** from step 3. You are now the first admin, and the token stops working.
3. Set up **two-factor authentication**: scan the QR code with an authenticator app (Aegis, 2FAS,
   Google Authenticator, 1Password…) and enter the code. It is mandatory for all staff.
4. Brand your community: name, tagline, colour (the dashboard refuses colours that would be hard to
   read), default language, logo, and the **operator's name and contact email** (shown in the legal
   pages and the accessibility statement).

✅ **Check:** reload `https://example.org`: your name, logo and colour are there, in light and dark mode.

## Step 7: Invite your moderators

Each moderator first signs in once at `https://admin.example.org` (so their account exists). Then,
on the server:

```bash
dc exec api node dist/cli/staff.js grant moderator@example.org moderator
dc exec api node dist/cli/staff.js list
```

Roles are `moderator` (reports, warnings, suspensions, photo verification) and `admin` (everything,
plus bans and the audit log). See [ADMIN.md](ADMIN.md) for how reports and decisions work.

## Step 8: Before you open the doors

- [ ] Adapt the drafts in [`docs/legal/`](legal/) (privacy policy, terms, cookies, accessibility
      statement) and the short in-app texts, and have them reviewed by a lawyer ⚖️
- [ ] Choose how long data is kept (`INACTIVE_ACCOUNT_DELETE_MONTHS` and the defaults in
      [ADMIN.md](ADMIN.md#6-retention-defaults-need-legal-review-)) ⚖️
- [ ] Turn on daily, encrypted backups and test a restore (see "Backups" below)
- [ ] Turn on disk or volume encryption at your server provider
- [ ] Go through the [production checklist](PRODUCTION_CHECKLIST.md) and the [privacy guide](PRIVACY.md)
- [ ] Publish a contact address for privacy, accessibility and moderation appeals
- [ ] Ideally, ask people who use screen readers or other assistive technology to try the app

## Optional extras

### Local AI (smarter matching and conversation starters)

By default Dateos uses no AI model at all: matching uses text similarity and conversation starters
come from ready-made templates in each language. To use a small model that runs **on your own server**
(nothing leaves it), you need about 4 GB of extra RAM:

```bash
dc --profile ai up -d ollama
dc --profile ai exec ollama ollama pull paraphrase-multilingual   # for matching
dc --profile ai exec ollama ollama pull qwen2.5:1.5b              # for conversation starters and bio ideas
```

Then set in `.env`:

```bash
EMBEDDINGS_PROVIDER=ollama
ICEBREAKERS_PROVIDER=ollama
```

and restart with the AI profile: `dc --profile ai up -d --force-recreate api worker` (from now on,
add `--profile ai` to your alias). Small models are fine in English and weaker in Hebrew and Arabic;
the templates remain the fallback. Details and the cloud option: [AI.md](AI.md).

### Push notifications

Off by default. They need your own build of the mobile app (Expo EAS) and `PUSH_PROVIDER=expo` in
`.env`. Notifications carry no names or message text, but they pass through Expo, Apple and Google, so
mention that in your privacy policy ⚖️. See [SELF_HOSTING.md](SELF_HOSTING.md#push-notifications-optional).

### App Store and Google Play apps

Not required: the web app works on phones and can be added to the home screen. For store apps, build
`apps/mobile` with Expo under your own developer accounts 📘. See
[SELF_HOSTING.md](SELF_HOSTING.md#mobile-apps).

### Lock the dashboard to your office or VPN

In `infra/web/Caddyfile`, uncomment the two `@outside` lines in the `admin.{$DOMAIN}` block and put
your own IP range in place of `203.0.113.0/24`, then run `dc up -d --build web`.

## Day to day

| Task                         | Command                                          |
| ---------------------------- | ------------------------------------------------ |
| Update to the latest version | `cd /opt/dateos && git pull && dc up -d --build` |
| See what's running           | `dc ps`                                          |
| Read the logs                | `dc logs -f api` (or `worker`, `web`, `clamav`)  |
| Apply a change to `.env`     | `dc up -d --force-recreate api worker`           |
| Stop everything              | `dc stop` (data is kept)                         |
| Start again                  | `dc up -d`                                       |

Database updates run automatically when the new version starts. Read [CHANGELOG.md](../CHANGELOG.md)
before updating.

### Backups

`scripts/backup.sh` saves the database and all stored photos and voice messages, encrypted with a
passphrase, and removes local copies older than 14 days. Set it up once:

```bash
head -c 32 /dev/urandom | base64 | sudo tee /root/.dateos-backup-key >/dev/null
sudo chmod 600 /root/.dateos-backup-key
sudo crontab -e
# add this line: a backup every night at 03:00
0 3 * * * cd /opt/dateos && BACKUP_PASSPHRASE_FILE=/root/.dateos-backup-key ./scripts/backup.sh
```

Copy the files in `/opt/dateos/backups/` to another place (another server or storage service), and
keep the passphrase and `.env` separately from them. Test a restore into a separate database from time
to time:

```bash
RESTORE_DATABASE=dateos_check BACKUP_PASSPHRASE_FILE=/root/.dateos-backup-key \
  ./scripts/restore.sh backups/dateos-db-<time>.dump.enc
```

## Troubleshooting

| What you see                                            | Likely cause                                       | What to do                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The browser warns the site is not secure                | The HTTPS certificate wasn't issued yet            | Check that all three names point at the server and ports 80/443 are open; then `dc logs web` and `dc restart web`                   |
| `/ready` shows something `down`                         | A service is still starting, or failed             | `dc ps`, then `dc logs <service>`. The virus scanner (`clamav`) can take several minutes on first start and needs about 1.5 GB RAM  |
| The sign-in email never arrives                         | Wrong SMTP settings, or the email went to spam     | Check the `SMTP_*` values, then `dc logs api`; set up SPF/DKIM; apply changes with `dc up -d --force-recreate api worker`           |
| Photos stay "processing"                                | The worker or the virus scanner isn't running      | `dc ps`; `dc logs worker` and `dc logs clamav`                                                                                      |
| I lost the setup token                                  | –                                                  | It's in `.env` as `SETUP_TOKEN`. Or sign in once and run `dc exec api node dist/cli/staff.js grant you@example.org admin`           |
| A moderator lost the phone with their 2FA app           | –                                                  | `dc exec api node dist/cli/staff.js reset-mfa them@example.org`, then they set it up again                                          |
| `./install.sh` says ".env already exists"               | The installer protects your existing secrets       | Don't re-run it on a working instance. Edit `.env` instead                                                                          |
| `install.sh --force` says "existing data volumes found" | New passwords wouldn't match the existing database | Keep your current `.env`. Only for a fresh start with **no data to keep**: `./install.sh --force --reset-data` (deletes everything) |
| The server runs out of disk space                       | Old images and build cache                         | `docker image prune` and `docker builder prune`; check the size of `backups/`                                                       |

## Questions and answers

**How much does it cost?**
The software is free and open source (MIT license), with no paid tier. Your costs are the server, the
domain and the email service, and they depend on the providers you choose.

**What do I need to know to run it?**
How to connect to a server over SSH, paste commands and edit a text file. For a growing community,
someone who is comfortable with Linux servers should look after updates and backups.

**Can I try it on my own computer first?**
Yes, with Node.js and pnpm installed. Run `./install.sh` without `--domain`, start the services with
the `full` and `dev` profiles, then `pnpm install` and `pnpm dev`, as the [README](../README.md#quick-start)
explains. Sign-in emails go to a local mailbox (Mailpit, <http://localhost:8025>) instead of real
addresses.

**Which languages does the app support?**
English, Hebrew, Arabic and Russian, with right-to-left layout for Hebrew and Arabic. Each member
picks a language in the app; you choose the default language in the dashboard.

**Where is my members' data stored?**
Only on your server: the database and the uploaded photos and voice messages live in Docker volumes
there. Nothing goes to the Dateos authors. Emails go through your email provider, and push
notifications (if you turn them on) through Expo, Apple and Google. The full list is in
[PRIVACY.md](PRIVACY.md).

**Do members need a password?**
No. They sign in with a link sent by email, so there are no passwords to leak. Google and Apple
sign-in can be added with the `GOOGLE_*` and `APPLE_*` settings in `.env`.

**Is the AI required? Does it send data to a company?**
No and no. By default there's no AI model at all. The optional local AI runs on your own server. A
cloud AI service is used only if you configure one and each member agrees.

**How many members can one server handle?**
In a load test with 5,000 members on a single 4-vCPU machine, finding matches took 62 ms and sending
a message 16 ms (95th percentile); see [PERFORMANCE.md](PERFORMANCE.md). For a bigger community, use a
larger server and watch memory and disk use with your provider's monitoring.

**Can I use my own name and logo?**
Yes, that's the point: name, tagline, colour, logo and default language are set in the dashboard.
The license only asks you to keep the MIT copyright notice in the source code.

**Is it legal to run a dating app for my community?**
That depends on your country and your audience, so ask a lawyer ⚖️. The repository includes drafts
of a privacy policy, terms of use, cookie policy and accessibility statement, plus a privacy guide
listing every kind of data stored, but they are starting points, not legal advice. In Israel, also
check the Privacy Protection Law and Amendment 13 (database registration, a privacy officer, data
security rules) ⚖️.

**Do I need a cookie banner?**
The app uses only the cookies needed to sign in, and no tracking or analytics, so it has no consent
banner; its "Privacy and cookies" page explains this. Check this with your lawyer if you add any tool
of your own ⚖️.

**How do I move to a new server?**
Make a backup on the old server, copy the backup files, `.env` and `infra/data/seaweedfs/s3.json` to
the new one, run steps 1, 2 and 5 there (not `install.sh`, which would create new passwords), restore
with `scripts/restore.sh <db-backup> <files-backup>`, and update DNS.

**Can I change the domain later?**
Yes. In `.env`, change `DOMAIN`, `PUBLIC_API_URL`, `CORS_ORIGINS` and `SMTP_FROM` to the new name,
add the new DNS records, and run `dc up -d --build` (the web app is rebuilt with the new address).

**How do I delete everything?**
`dc down -v` stops Dateos and **permanently deletes all data**, including every member's account.
Make and keep a backup first if you might need it, and tell your members in advance ⚖️.

**Where do I get help or report a bug?**
Open an issue on [GitHub](https://github.com/diamondrubinny/Dateos/issues). For security problems,
follow [SECURITY.md](../SECURITY.md) and don't post them publicly.
