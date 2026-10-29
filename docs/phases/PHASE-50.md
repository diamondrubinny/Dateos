# Phase 50: The one-command install, run for real (v1.23)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

Phase 48's bootstrap script was tested in CI only in prepare mode (`START=0`): nothing had built the
images and started a production stack from it. Operators were about to run it on real servers.

## The run

In the test sandbox, the published script from `main`, with a separate Compose project and a test
domain: `COMPOSE_PROJECT_NAME=nhtest NEXAHEART_DIR=/opt/nhtest DOMAIN=example.test BACKUP=0`.
(The sandbox's safety rules don't allow the daily backup cron, so that step was skipped; it was
tested in phase 48 by running `backup.sh` itself.)

| Attempt | Result                                    | What it showed                                                                                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Build failed: `SELF_SIGNED_CERT_IN_CHAIN` | The sandbox reaches the internet through a proxy that inspects HTTPS; Node inside the build doesn't trust it. Not a product bug (CI builds the same images), but it can happen on company networks: now in the troubleshooting tables. For the test only, the proxy CA was added to a throwaway copy's Dockerfiles. |
| 2       | Build failed: `no space left on device`   | The update path works (existing `.env` kept, code fast-forwarded). On a full disk the build died halfway with an unclear message.                                                                                                                                                                                   |
| 3       | **Success**                               | 7 services up (API healthy), `/ready` reports all 10 dependencies `up`, all 51 migrations applied on first start, port 80 redirects to HTTPS. (HTTPS itself can't get a certificate for a test domain; with real DNS Caddy issues it.)                                                                              |

## Changes

- `scripts/bootstrap.sh` checks the free space on Docker's disk first and stops with a clear
  message under `MIN_FREE_GB` (default 10), before any download or build.
- After a successful start it removes dangling images, so updates don't slowly fill the disk.
- Troubleshooting rows (en, he): "only N GB free" and `SELF_SIGNED_CERT_IN_CHAIN`.

## Noted, not changed

`infra/docker-compose.yml` fixes the project name (`name: nexaheart`), so two installs on one
machine would share volumes unless `COMPOSE_PROJECT_NAME` differs. One instance per server is the
documented setup, so it stays.
