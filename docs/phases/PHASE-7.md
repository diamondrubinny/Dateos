# Phase 7: Hardening and release

> Status: ✅ done (2026-10-21). 📘 = verify against official docs, ⚖️ = needs legal review, 🔍 = needs an
> external professional (penetration tester, accessibility consultant).

## Scope

| #   | Deliverable                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Security review** of every module (auth, sessions, uploads, chat/WebSocket, discovery visibility, moderation/staff, instance setup, export): authorization on the server, IDOR, input limits, injection, SSRF, secrets, headers. Each finding verified with a test before it's fixed                                                                                    |
| 2   | **Dependency audit**: `pnpm audit` for production dependencies, fix or document every advisory; SBOM (CycloneDX) generated in CI                                                                                                                                                                                                                                          |
| 3   | **Performance**: discovery and chat under load with a realistic data set (thousands of members); query plans and indexes checked; p95 latency targets recorded                                                                                                                                                                                                            |
| 4   | **Accessibility pass beyond axe**: keyboard-only walkthrough of the main flows, 200% zoom, reduced motion, focus order — automated where possible, the rest in a manual checklist 🔍                                                                                                                                                                                      |
| 5   | **Production checklist** (`docs/PRODUCTION_CHECKLIST.md`): functional, roles, auth/session, input/API/upload security, malware scanning, secrets, dependencies, backups and restore, data table, cookies list, consent, legal drafts, accessibility, mobile/RTL/performance/SEO, and what needs a lawyer, privacy officer, accessibility consultant or penetration tester |
| 6   | **Release**: version 0.1.0, `CHANGELOG.md`, backup/restore scripts and guide, app-store notes (privacy labels, age rating) 📘                                                                                                                                                                                                                                             |

## Targets

| Metric                                           | Target           |
| ------------------------------------------------ | ---------------- |
| `GET /v1/discover` p95, 5 000 members, 1 vCPU    | < 300 ms         |
| `POST /v1/matches/:id/messages` p95              | < 100 ms         |
| Production dependency advisories (high/critical) | 0, or documented |
| axe-core violations                              | 0                |

## Out of scope (needs people, not code)

External penetration test 🔍, manual screen-reader audit by a consultant 🔍, legal review of the drafts ⚖️,
App Store / Play review (needs the operator's developer accounts) 📘.

## Results

| Area            | Result                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security review | 3 parallel code reviews; **15 findings fixed** (1 high, 3 medium, 11 low), 1 accepted risk. Details and tests: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md)                                                                               |
| Most serious    | Native sign-in put the session in a deep link that another Android app could intercept (and the app never read it, so native sign-in didn't work). Replaced with a PKCE code exchange                                                    |
| Dependencies    | `pnpm audit --prod`: 2 high + 2 moderate, all in build tooling with no runtime use; the 2 high have no patched version and are ignored by GHSA id only. **This had turned CI red since phase 3b**; fixed                                 |
| SBOM            | CycloneDX 1.7 (cdxgen 12.8.5), ~1 000 components, generated and checked in CI (`pnpm sbom`)                                                                                                                                              |
| Performance     | 5 000 members: discovery p95 **62 ms**, send p95 **16 ms** ([PERFORMANCE.md](../PERFORMANCE.md)); discovery planning time removed with a prepared statement                                                                              |
| Accessibility   | New `e2e/a11y.ts`: keyboard-only sign-in with visible focus at every stop, reflow at 320 px, 200% text, reduced motion, `lang`/`dir`, EN + HE: all pass. The focus detector was itself checked (it first passed elements without a ring) |
| Backups         | `scripts/backup.sh` / `restore.sh`, AES-256 encrypted; round trip tested (same rows, same migration history)                                                                                                                             |
| Release         | 0.1.0, [CHANGELOG.md](../../CHANGELOG.md), [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md)                                                                                                                                         |
| Tests           | Integration **108** (14 new), unit: api 38, ai 45, shared 22, worker 14, mobile 8, admin 3                                                                                                                                               |

## Migrations added

`0012_photos_changed_at` (verified badge tied to the photos), `0013_instance_claim` (one-time setup
claim; existing instances with an admin are marked as claimed).

## Still needs people

External penetration test 🔍, screen-reader audit by a consultant ♿, legal review ⚖️, real-device
testing of native sign-in, sharing and push, and store review 📘.
