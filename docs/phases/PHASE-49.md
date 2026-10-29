# Phase 49: Accessibility sweep of the moderation dashboard (v1.22)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.
> An automated and visual check, not a conformance claim; a manual audit is still needed ⚖️.

## Why

Phase 47 swept the member app and left the dashboard, which has its own styles, for later.

## Checked

- **Colours**: every text pair of the dashboard theme (page, cards, the urgent/high/normal priority
  badges, success and error panels, buttons) in light and dark: all at least 4.5:1 already. The
  focus ring was already 3 px with a 2 px offset, at 6.2 to 10.5:1.
- **e2e `pnpm --dir e2e admin-a11y`** (en, he): an admin signs in (with two-factor authentication)
  and opens all ten pages plus a report with content, in dark and light mode (one sign-in, the page
  follows the emulated system setting): 44 axe-core audits, 0 violations.

## Found and fixed

**Form field edges** were 1.45:1 (light) and 1.47:1 (dark), and the field background is nearly the
same as the card (1.05:1), so the faint edge was the only thing marking where to type (WCAG 1.4.11).
axe-core doesn't test non-text contrast, so the e2e measures it from the computed styles. A new
`--control` colour (as in the app) for text fields, text areas, selects and the colour picker:
now 4.26:1 in both modes. `--border` stays for decorative lines.

Screenshot: `125-admin-dark`.
