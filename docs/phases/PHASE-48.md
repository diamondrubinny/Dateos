# Phase 48: One-command install over SSH, and a backup fix (v1.21)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

Installing took four manual stages (prepare the server, clone, `install.sh`, edit `.env`, start)
and `install.sh` refuses to run twice, so updating was a separate procedure. Operators asked for a
single command over SSH.

## What

`scripts/bootstrap.sh`, run as root:

```bash
ssh root@SERVER 'curl -fsSL https://raw.githubusercontent.com/diamondrubinny/NexaHeart/main/scripts/bootstrap.sh | DOMAIN=example.org SMTP_HOST=smtp.example.net SMTP_USER=... SMTP_PASSWORD=... bash'
```

1. Installs what's missing: `git`, `openssl`, `curl` (apt, dnf or yum) and Docker with Compose v2
   (Docker's official convenience script 📘). Adds a 4 GB swap file when the server has less than
   about 4 GB of memory and no swap, so the image builds don't run out of memory.
2. Clones into `/opt/nexaheart` (`NEXAHEART_DIR`), or fast-forwards an existing clone. Local changes
   that conflict stop it with a clear message; it never resets anyone's work.
3. First run: `install.sh --domain` (secrets, `.env`). Later runs keep `.env`, and refuse if it was
   set up for another domain.
4. Writes the SMTP settings as `KEY='value'` lines: literal for Docker Compose and for the shell, so a
   password with `$`, `&`, `|` or spaces stays exactly as typed. A single quote or a line break is
   refused rather than mangled.
5. Opens 80/tcp, 443/tcp and 443/udp if `ufw` is active (it never turns ufw on, so SSH can't be
   locked out). Warns when a DNS name doesn't resolve yet.
6. Builds and starts `app` + `full` (+ `video`, `ai` when asked), waits up to 20 minutes for
   `http://127.0.0.1:4000/ready`, and shows the container states if it never comes up.
7. Daily encrypted backup in `/etc/cron.d/nexaheart-backup` with a generated key in
   `/root/.nexaheart-backup-key` (`BACKUP=0` to skip).
8. Prints the addresses and, on the first run, the one-time setup token.

`START=0` prepares without building or starting (edit `.env` first; also what CI runs).

What still needs a person: DNS records before the run, and in the browser, signing in, entering the
setup token and setting up two-factor authentication (an authenticator app can't be automated, by
design).

## Bug found on the way: daily backups failed on installed servers

`scripts/backup.sh` and `restore.sh` loaded `.env` with `. ./.env`. The tagline line in
`.env.example` (`INSTANCE_TAGLINE=Free, open-source dating. …`) isn't valid shell, so on every server
set up with `install.sh` the backup stopped at once (exit 127, `open-source: command not found`)
before writing anything. Reproduced locally, then fixed:

- Both scripts now read only `POSTGRES_USER` and `POSTGRES_DB` from `.env`, as text.
- `.env.example` quotes the tagline.

Existing servers get the fix with `git pull` (or by re-running the bootstrap command); their `.env`
doesn't need to change. **If you run an instance, check that recent backups exist.**

## CI

The installer job now runs `shellcheck` on every script, and runs the bootstrap in `START=0` mode
from the checked-out code: it checks the special-character password survives, that Compose accepts
the result, and that the tagline is quoted.

## Security notes

- Piping a script from the internet into a root shell trusts this repository's `main` branch;
  operators can pin a tag with `NEXAHEART_REF` and read the script first.
- The SMTP password typed on the command line stays in the operator's local shell history unless
  the line starts with a space (`HISTCONTROL=ignorespace`) or the history is cleared. Documented in
  the guides.
- Nothing is sent anywhere except to GitHub (code), Docker (packages) and the operator's own SMTP.
