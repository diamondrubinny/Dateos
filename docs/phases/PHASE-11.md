# Phase 11: Installation guide with questions and answers (English and Hebrew)

> Status: ✅ done (2026-10-22). 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: someone who has never run a server can bring up a community instance step by step, and find
answers to the usual questions without reading the code.

## Scope

| #   | Deliverable                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/INSTALL.md` (English) and `docs/INSTALL.he.md` (Hebrew, right to left): numbered steps, each with "how to check it worked"    |
| 2   | Optional extras: local AI (including the model download, which the stack does not do by itself), push, native apps, admin allowlist |
| 3   | Day to day: updates, backups, logs, stop and start                                                                                  |
| 4   | Troubleshooting table: symptom, likely cause, fix                                                                                   |
| 5   | Questions and answers: cost, skills needed, languages, data, legal, AI, scale, moving servers, uninstalling                         |
| 6   | Marketing site: a short FAQ section in both languages linking to the guide; README and SELF_HOSTING link to the guide               |

## Rules

- Every command and setting is taken from `install.sh`, `infra/docker-compose.yml`, `.env.example` and
  the code, not from memory. Anything about third-party services (Docker install, DNS panels, SMTP
  providers, app stores) points to their official docs 📘.
- No prices, no compliance claims; legal questions say "ask a lawyer" ⚖️.

## Found while preparing

- `.env.example` offered `INSTANCE_LOCALES=he,en`, while the code defaults to all four languages and
  the app always offers all four: aligned to `he,en,ar,ru`.
- Turning on local AI needs the models downloaded once (`ollama pull`); no document said so.

## Results

| Check  | Result                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Guides | `docs/INSTALL.md` and `docs/INSTALL.he.md`: 8 steps with checks, extras, day to day, backups, 9 troubleshooting rows, 15 questions              |
| Facts  | Commands, service names, CLI, ports and settings checked against `install.sh`, `infra/docker-compose.yml`, `.env.example` and the code          |
| Links  | Every relative link in both guides points to an existing file                                                                                   |
| Site   | "Questions" section (6 questions, native `<details>`), guide link that follows the page language; checked at phone width in Hebrew, no overflow |

## Corrections made while writing

- The load-test answer first said "on the recommended setup"; the test ran on one 4-vCPU machine
  ([PERFORMANCE.md](../PERFORMANCE.md)), so it now says so, with the measured numbers.
- Trying NexaHeart locally needs the `dev` profile for the local mailbox (Mailpit); `pnpm infra:up` alone
  doesn't start it.
