# Phase 64: Compliance kit in the dashboard (v1.38)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.
> Item 3 of the market research roadmap (`docs/research/market-gaps-2026-10.he.md`).

## The gap (checked in the code)

- Phase 61 records every decision with its ground, automated detection and appeals, but there's no
  way to get the numbers out. Online platforms in the EU publish a transparency report (DSA
  Art. 15 and 24; the Commission's harmonised templates apply from 1 July 2025) 📘.
- Staff access to member data is already audited (`staff.report_viewed`, `staff.selfie_viewed`,
  `staff.photo_viewed`, `staff.evidence_audio_played`), but the Audit page mixes it with everything
  else: an operator asked "who looked at what" has to scroll.
- No place to record a security incident. Israel's data security regulations and Amendment 13
  expect incidents to be documented and severe ones reported to the Privacy Protection Authority;
  GDPR Art. 33 expects a notification within 72 hours where there's a risk ⚖️ 📘.
- No starting point for the documents operators are asked for: a security statement (after the
  Atraf leaks an Israeli LGBTQ+ audience will ask what's stored and encrypted), a no-paid-features
  pledge (as Alovoa makes), a risk assessment that fits the community (an LGBTQ+ community has
  outing and extortion risks; a 50+ community has more romance scams).

## What changes

| Part                | Change                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transparency report | Dashboard → Compliance: choose a period (up to a year); see and download (JSON, CSV) the counts: notices by source (members, automatic checks, partner communities) and category; decisions by action and ground, how many came from automatic detection, how many were reversed; median time to a decision; appeals received, upheld, reversed, open. |
| Staff access        | Audit page: "Staff access to member data only" filter.                                                                                                                                                                                                                                                                                                 |
| Security incidents  | Dashboard → Compliance: record an incident (what, kind, severity, when it happened and was found, how many members may be affected, what was done), then update it (authority notified, members notified, closed). The 72-hour mark is shown for high and severe incidents until the authority is notified. Never deleted; every change is audited.    |
| Templates           | Dashboard → Compliance: download, in English or Hebrew, a security statement, a no-paid-features pledge and a risk assessment, filled from this community's actual settings (what it turns on, retention, partners, age checks). Each starts with "draft for legal review".                                                                            |

## Security and privacy ⚖️

- The transparency report has counts only: no names, ids or text. Decisions removed by the
  retention rules (`MODERATION_LOG_RETENTION_DAYS`) or with deleted accounts aren't counted; the
  report says so.
- Incidents are about systems, not people: the form says not to write names, emails or message text,
  and refuses markup. Admins only (moderators can't see or write them).
- The templates never promise more than the software does: each claim is generated from what's
  actually configured, and the rest is left for the operator to fill.

## Tests

- Unit: the period (from ≤ to, at most 366 days), incident input (plain text, sizes, dates in
  order), CSV escaping.
- Integration: the report counts notices, decisions, automatic detection, reversals and appeals in
  the period only; moderators refused; incidents created, updated, audited, admins only, never
  deleted; staff access filter; templates follow the settings (faith module, age check, partners)
  and are drafts.
- e2e (en, he): an admin downloads a report for the period, records a severe incident and sees the
  72-hour mark, filters the Audit page to staff access, downloads the Hebrew security statement.
  axe 0. Screenshots.

## Order of work

1. Shared schemas; DB table; migration.
2. API: report, incidents, audit filter, templates; tests.
3. Dashboard: Compliance page, Audit filter; i18n.
4. e2e, docs, PR, merge.

## Done

- **Unit** (shared, 4): the period (from ≤ to, at most 366 days, real dates); incidents in plain
  text with line breaks, known kinds and severities, dates in order, unknown fields refused; the
  72-hour mark for high and severe incidents until the authority is notified; the CSV, one number
  per row.
- **Integration** (5, `compliance.test.ts`): the report counts notices by source and category,
  notices closed with and without action, decisions by action and ground, automatic detection,
  a reversal on appeal and the appeal, only in the period; no ids, names or text in it; the period
  is checked; moderators and members refused; incidents created, updated, checked against the saved
  dates, audited (the fields that changed, never their text), no way to delete; the staff access
  filter; templates follow the settings (operator, contact, faith module, a 50+ minimum age) in
  English and Hebrew, unknown names and languages refused.
- **e2e** `pnpm --dir e2e compliance` (en, he): an admin shows the report and downloads the CSV;
  records a severe incident and sees "Notify the authority by", which goes away once marked; downloads
  the Hebrew security statement (a draft); filters the audit log to staff access. axe 0. Screenshots
  `admin-35-compliance`, `admin-36-staff-access` (en, he).
- Found on the way: dismissing a notice isn't a decision against anyone and was never logged as one,
  so the report counts restrictions as decisions and closed notices separately; a template line
  about "only verified members can write" was removed, since that's phase 65, not yet built.
- Docs: ADMIN.md (7g), PRIVACY.md (incident log), CHANGELOG, README.

### Next

- The DSA harmonised template's exact fields (Implementing Regulation (EU) 2024/2835) 📘: map the
  report onto it once checked against the official text.
- Israel Amendment 13 database definitions document and DPO thresholds ⚖️ 📘.
