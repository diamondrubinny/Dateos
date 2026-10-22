# Phase 10: Marketing site (English and Hebrew)

> Status: ✅ done (2026-10-22). 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: a public landing page that explains Dateos to communities and operators, in **English and
Hebrew** (right-to-left), with real screenshots, published as a shareable page and kept in the repo.

## Scope

| #   | Deliverable                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `site/src/page.html`: one page, language switch (EN / עברית, `#en` / `#he`, browser language by default), RTL, light and dark     |
| 2   | Sections: hero, "Dating Facts" label (the numbers that matter: 0 ads, 0 paid features…), feature tour, operators, install, trust  |
| 3   | Screenshots swap with the language (`img/<lang>/…`), generated from `docs/screenshots` by `site/build.mjs` (WebP, resized)        |
| 4   | `site/build.mjs` writes `site/dist/` (a full HTML document with description and Open Graph tags, plus images) for any static host |
| 5   | Published as a private shareable page; the README links to `site/`                                                                |

## Rules

- No third-party scripts, analytics or cookies; only Google Fonts (the published page's CSP allows
  only that host). Self-hosters can swap them for local fonts ⚖️ (fonts from Google send the visitor's
  IP to Google; for an EU audience self-host the fonts).
- WCAG 2.1 AA: semantic landmarks, skip link, visible focus, `aria-pressed` language buttons, alt text
  in both languages, contrast from the app's checked tokens, `prefers-reduced-motion`.
- Claims only what is true and tested; legal texts are called drafts; no compliance claims.

## Non-goals

A GitHub Pages deploy workflow: every action in this repo is pinned to a verified commit SHA, and
enabling Pages is a repository setting the owner turns on. `site/dist/` works on any static host.

## Results

| Check         | Result                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build         | `node site/build.mjs`: page plus 26 WebP screenshots (13 per language), about 1.1 MB in total                                                                                                                         |
| Layout        | Desktop (1360 px) and phone (390 px), English light and Hebrew dark: no horizontal overflow, no script errors, `dir="rtl"` set                                                                                        |
| Facts checked | No passwords (`emailAndPassword` disabled), 272 automated tests (153 unit + 119 integration), push goes through Expo/Apple/Google and carries no names or text, so the page says so instead of "providers you choose" |
| Published     | As a private shareable page (the owner shares it from its Share menu); source in `site/`                                                                                                                              |

## Known limitations

- Fonts load from Google Fonts; a self-hosted copy is better for an EU audience ⚖️.
- One URL for both languages (`#he`), so search engines index the English text only; a separate
  `he/index.html` can be added later if Hebrew search traffic matters.
