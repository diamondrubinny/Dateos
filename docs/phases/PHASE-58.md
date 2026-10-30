# Phase 58: The repository tells the current story (README, marketing pages, screenshots)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.

## What was out of date (checked)

| Where                                     | Problem                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` status table                  | Ends at phase 24 (integrations). Phases 25–57 are missing: accessibility needs, partner communities, chat controls, quiet hours, updates from the dashboard, PWA… |
| `README.md` screenshots                   | No pictures of anything after phase 24; "All 74 screens" while there are 172 (en) and 170 (he)                                                                    |
| `README.md` "Running a public instance"   | Shows the old three commands, not the one-command install over SSH (phase 48)                                                                                     |
| Marketing pages (en, he, ar, ru), `site/` | `git clone …/Dateos.git` + `./install.sh`: the old repository name and the old way                                                                                |
| Marketing pages                           | Nothing about running it (updates, backups, alerts), the installable app, the newer member features                                                               |

## What changes

1. **New showcase strips**, built from the screenshots the e2e runs already took (no fake screens),
   in English and Hebrew: everyday chat, your profile and accessibility, dates, partner communities,
   dark mode and offline, and a grid of the dashboard's System page (backups, updates, scheduling,
   history). `e2e/showcase-readme.ts` rebuilds them.
2. **README**: "Why" adds running it without a sysadmin and the installable app; the status table
   covers phases 25–57 (grouped); new screenshot sections; the real counts; the one-command install.
3. **Marketing pages**: en and he get the new sections and rows; all four (and `site/`) get the
   current install command and repository address.

Nothing here changes how the software works.

## Order of work

1. `e2e/showcase-readme.ts`; build the strips; look at each.
2. README.
3. Marketing pages (en, he in full; ar, ru: install command and the installable app row) and `site/`.
4. Prettier, link check (every image path exists), PR, merge.

## Done

- 12 new images (6 subjects × en, he), all built from existing e2e screenshots; each looked at.
- README: 3 new "Why" points, 12 new status rows (phases 25–57), 5 new screenshot sections plus
  the dashboard grid, real counts (172 en, 170 he, 91 ar, 90 ru), the one-command install.
- Marketing pages: en and he with 3 new rows and 6 new sections; all four with the one-command
  install, the guide link and 355 integration tests (was "100+"); ar and ru with 2 new rows.
- `site/`: the one-command install, a fourth install point (backups, updates), links to the
  repository's current name; checked at phone width (no sideways scroll).
- Every image path in the README and the marketing pages exists (checked by script).
