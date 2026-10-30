# Phase 61: The reasons for a decision, and a way to appeal it (v1.33)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.
> Chosen by the research in `reports/` (2026-10-30): the first of eight candidate phases.

## The gap (checked in the code)

- A member who is warned sees only the category ("harassment"). A suspended member sees one
  sentence for every case ("for breaking the community guidelines, or because of the age
  requirement") and the only thing they can do is delete the account (`account.suspendedAppeal`).
- Staff write one internal note (`reason`), never shown. Nothing records whether the decision is
  under the community's rules or the law, nor whether an automatic check found it.
- There is no appeal: lifting a suspension is a staff action only (`/v1/admin/users/:id/unsuspend`).

The EU Digital Services Act asks every hosting service, whatever its size, to give a **statement of
reasons** for each restriction (Art. 17: what was decided, the facts, whether automation was used,
the legal or contractual ground, and how to seek redress). Online platforms must also run an
**internal complaint-handling system** for at least six months after the decision, decided by
people, not only by automation (Art. 20); micro and small platforms are exempt from Art. 20 (Art. 19) ⚖️, but members of a small community deserve the same. Hinge moved to explained, appealable
moderation in September 2025. 📘 EUR-Lex 2022/2065; nothing here is legal advice.

## What changes (61a: this phase)

| Part               | Change                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision (staff)   | Warn, suspend and ban record a **ground** (community rules / against the law ⚖️) and an **explanation for the member** (the facts, in plain words, 10–1000 characters, required), beside the internal note that stays internal. Whether an automatic check found it is recorded from the report.                                                                                      |
| Statement (member) | `GET /v1/me/decisions`: each decision about my account in the last 2 years: what, when, why (category, ground, explanation), whether an automatic check found it, that a person decided it, and until when I can appeal. Also while suspended.                                                                                                                                        |
| Appeal (member)    | `POST /v1/me/decisions/:id/appeal`: once per decision, within 6 months, up to 1000 characters. While suspended too. A receipt in the app.                                                                                                                                                                                                                                             |
| Appeals (staff)    | Dashboard → Appeals: the decision, the explanation, the internal note, the appeal; **uphold** or **reverse**, with a reply the member reads. Not by the person who made the decision (unless they are the only admin), never by the member themselves. Reversing a suspension or a ban needs an admin, and lifts it (as today's "lift suspension"); reversing a warning withdraws it. |
| Notices            | Staff get an email that an appeal is waiting (no content, as for urgent reports). The member gets an email that the appeal was decided (no content: sign in to read it) and a notice in the app.                                                                                                                                                                                      |
| App                | Suspended screen: the statement and the appeal form (or its state). A warning notice links to the same screen. Settings → "Decisions about my account". 4 languages.                                                                                                                                                                                                                  |
| Data               | "Download my data" includes the decisions about me (without the internal note) and my appeals. Deleted with the account; kept 2 years like the moderation log ⚖️.                                                                                                                                                                                                                     |

**61b (next):** remove a single photo or text instead of the whole profile; mark a report as "I
believe this is illegal" with a good-faith statement; a notice form for people without an account.

## Security and privacy ⚖️

- Members never see the internal note, the name of the staff member, or the reporter.
- Appeals are only for one's own decisions (404 otherwise); one per decision (409); not after 6
  months (409). Rate-limited.
- Every appeal decision is in the audit log; the appeal text is shown only in the dashboard (staff
  with two-factor sign-in).
- The explanation is written by staff and shown as plain text (no HTML, no links made clickable).

## Accessibility

- The statement is text with headings; the appeal form has a label, a hint, a character count and
  an error read out; the outcome is text, not colour.

## Tests

- Unit (shared): schemas and the appeal window.
- Integration: explanation required for warn/suspend/ban; the member's statement (no internal note,
  no staff name; ground, explanation, automatic detection); appeal while suspended; one per
  decision; not someone else's; not after 6 months; the decider can't decide the appeal (unless the
  only admin); moderators can't reverse a suspension; reversing lifts it and the member can use the
  app again; reversing a warning withdraws it; the notice and the emails; the export.
- e2e (en, he): a moderator suspends with an explanation; the member signs in, reads it, appeals;
  an admin reverses it in the dashboard; the member is back. axe 0. Screenshots.

## Order of work

1. Shared schemas; DB columns and `moderation_appeals`; migration.
2. API: decision fields; member routes; staff routes; emails; export; integration tests.
3. Dashboard: decision form fields; Appeals page.
4. App: decisions screen, suspended screen, warning link, settings entry; i18n ×4.
5. e2e, screenshots, docs (PRIVACY, moderation guide, CHANGELOG), PR, merge.

## Done

- **Shared** (unit, 3): an explanation is required for warn, suspend and ban (10–1000 characters,
  trimmed), not for dismiss; the ground defaults to the community's rules; the appeal window is 183
  days; appeal and reply lengths.
- **Integration** (8, `appeals.test.ts`): the explanation is required; the member's statement has
  the action, category, ground, explanation, automatic detection, the 183-day window, and never the
  internal note, the moderator or the reporter; only the member sees it; a suspended member reads
  it and appeals (201), once (409), not someone else's (404); staff are emailed without content;
  the moderator who decided, and any moderator for a suspension, can't decide it (403); an admin
  reverses it: the account is active again, the member is emailed without the outcome or the
  reply, reads it in the app, dismisses the notice; audited; upheld keeps a ban; a community's only
  admin may review their own decision; a withdrawn warning is no longer shown; not after 6 months
  (409); reversing an older suspension leaves a later ban in force; "Download my data" has the
  decisions as told and the appeals, not the internal note. The existing safety, report-outcome,
  calls and partner-community tests send the explanation now.
- **e2e** `pnpm --dir e2e appeals` (en, he): a moderator suspends with an explanation; the member
  signs in, the suspended screen shows what, why, the ground and that a person decided (not the
  note, not who reported); an empty appeal is refused with the reason read out; the appeal is sent;
  an admin reverses it in the dashboard; the account is active, the email has no reply; the notice
  and the decisions page show the reply. axe 0. `safety` now fills the explanation in the
  dashboard; `report-outcome` passes.
- Screenshots `139-decision-suspended`, `140-appeal-sent`, `141-appeal-decided`, `142-decisions`,
  `admin-30-appeals` (en, he).
- Docs: ADMIN.md (reasons and appeals, retention), PRIVACY.md (2 rows), privacy policy en/he
  (rows and "Automated decisions"), CHANGELOG, README. The research behind this choice:
  `docs/research/next-phases-2026-10.he.md`.

### Known limits

- Age suspensions have no in-app appeal (the date of birth is final); operators publish a contact
  address (phase 62 adds age assurance).
- A decision taken by a partner community about its own member is appealed there (phase 28d).
- ⚖️ Whether a members-only community is an "online platform" under the DSA, and the wording of
  explanations, need legal review per operator.
