# Phase 7: Hardening and release

> Status: in progress. 📘 = verify against official docs, ⚖️ = needs legal review, 🔍 = needs an
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
