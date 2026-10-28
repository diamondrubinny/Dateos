# Phase 37: "Your report was reviewed", kinder icebreakers (v1.10)

> Status: ✅ done (2026-10-28). 📘 = verify against official docs, ⚖️ = needs legal review.

## 37a. Telling the reporter

A member who reports someone hears nothing afterwards, so reporting feels like shouting into the
void. Now, once a moderator decides:

- The reporter sees a notice in the app (the same place as warnings, phase 4): **"Your report was
  reviewed"**, with the category and the date it was sent, and one of two outcomes:
  - **"We took action."** Never which action (warning, suspension, ban), and never the other
    person's account status ⚖️.
  - **"We didn't find a rule broken this time."** With a reminder that blocking is always available.
- Shown for reports resolved in the last 30 days, until dismissed ("OK"). Only reports a member
  sent: automatic reports (phase 34) and reports from partner communities (phase 28d) have no
  reporter here.
- Nothing about the reported person is shown that the reporter didn't already know (no name: a
  member who reported several people sees category and date).
- Data: `reports.reporter_seen_at` (migration `0044_report_outcome.sql`). Dismissing uses the
  existing `POST /v1/me/notices/:id/ack`, scoped to the member's own reports (404 otherwise).

## 37b. Kinder icebreakers in Hebrew

The Hebrew icebreakers members send used slash forms ("מוותר/ת", "את/ה חנון/ית"), awkward in a
message to one person. They're rephrased so no gender is assumed and no slash is needed.

## Order of work

1. db, shared, API (notices, ack); integration tests.
2. App: the notice; i18n ×4. Icebreakers. e2e `pnpm --dir e2e report-outcome`.
3. Docs (privacy: what the reporter learns ⚖️), PR, CI, merge.
