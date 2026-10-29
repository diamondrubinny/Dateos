# Phase 47: Accessibility sweep, contrast, focus and dark mode (v1.20)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.
> Not a claim of conformance: an automated and visual check of what the tests reach. A manual
> audit with screen readers by an accessibility consultant is still needed ⚖️.

## Why

Phase 46 found low contrast in a state no test had visited (closed date cards). Only one e2e ran in
dark mode, so this phase checks the colours themselves and visits the main screens in dark mode.

## Found and fixed

| Finding                                                                                                                                                                                                                                                                | WCAG          | Fix                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brand colour in dark mode**: brand text on the soft brand colour (every secondary button) was 4.02:1 with the default colour and down to 3.25:1 for other accepted colours; on cards 4.0 to 4.4:1. Every community has a brand palette, so this was live by default. | 1.4.3         | `deriveBrand` now adjusts the colour in small steps (darker for light mode, lighter for dark mode) until it reads at 4.5:1 on **every** background the apps use, the soft brand colour included. A colour that already passes is used unchanged (the default in light mode). |
| **Focus ring in light mode**: amber `#F59E0B` on white was 2.15:1, and drawn against the control it was nearly invisible on filled buttons.                                                                                                                            | 1.4.11, 2.4.7 | Darker amber `#B45309` (5:1 on white) and a 2 px gap between ring and control (`focusRing()`), used by every pressable component.                                                                                                                                            |
| **Text field and choice chip edges** at 1.46:1 (light) and 1.6:1 (dark).                                                                                                                                                                                               | 1.4.11        | A new `control` token (4.3:1 and 4.7:1). `border` stays for decorative separators.                                                                                                                                                                                           |
| **Profile preview** (phase 44) had no control when the profile was visible, so the page couldn't be scrolled from the keyboard.                                                                                                                                        | 2.1.1         | An "Edit my profile" button at the end (also the natural next step).                                                                                                                                                                                                         |

## Kept honest by tests

- `packages/shared/test/branding.test.ts`: every colour on a 7×7×7 grid the server accepts as a
  brand colour reads at 4.5:1 on every background, in both modes.
- `apps/mobile/test/contrast.test.ts`: all text colours on all backgrounds (light, dark, and high
  contrast), button text, and `control`/`focus` at 3:1. The background list the brand check uses is
  asserted equal to the theme tokens, so the two can't drift.
- e2e `pnpm --dir e2e a11y-dark` (en, he): 18 screens in dark mode with real content (chat with an
  open and a declined date idea, an active check-in), axe on each; the focus ring's computed style
  (3 px, 2 px offset) in light and dark. Screenshots `122-dark-chat`, `123-dark-checkin`,
  `124-focus-ring`.

## Not covered here

The admin dashboard has its own styles; it gets the same sweep separately. Native (iOS/Android)
focus and screen-reader behaviour need device testing 📘.
