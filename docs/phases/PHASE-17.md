# Phase 17: "Powered by NexaHeart" credit, protected by the license (v0.5)

> Status: ✅ done (2026-10-22): the user chose AGPL-3.0 with an attribution term (section 7(b))
> and the wording "Powered by NexaHeart · Open source", linking to nexaheart.com.
> 📘 = verify against official docs, ⚖️ = needs legal review.

## Goal

Every copy of NexaHeart, including forks and rebranded communities, keeps a visible credit:
**"Powered by NexaHeart · Open source"**, linking to https://nexaheart.com. Operators still choose
their own name, logo and colours; the credit stays alongside them.

## The honest part

In open-source code nothing is impossible to delete: anyone with the code can edit it. So the credit
is protected in two ways:

1. **Legally (the strong part)**: the license moves from MIT to **AGPL-3.0-or-later** with an
   **additional term under section 7(b)**: keep the credit. Removing it breaks the license, so the
   copyright holder can enforce it ⚖️.
2. **Technically (the friction)**: the credit lives in many places (every source file's header,
   screens, emails, the API, HTML, the installer) and CI fails if it's missing.

Versions already released under MIT (up to 0.4) stay MIT for whoever got them; the change covers
new versions only ⚖️.

## Why AGPL-3.0 with section 7(b)

- Section 7(b) of the GPL family explicitly allows "requiring preservation of specified reasonable
  legal notices or author attributions". Recipients may **not** remove such terms, unlike other
  "further restrictions" 📘 https://www.gnu.org/licenses/agpl-3.0.html#section7.
- AGPL also requires that anyone running a **modified** version as a service offers its users the
  source (section 13). The "Open source" part of the credit links to the source (configurable, so a
  fork can point to its own code).
- **Alternatives**:
  - CPAL-1.0 was built for UI attribution, but it's less known and has fewer tools.
  - Staying with MIT has no legal hold on the UI credit.
- **Costs**:
  - Companies that want to keep their changes closed can't use NexaHeart (intended).
  - App stores: GPL licenses and the App Store terms have conflicted before. The copyright holder
    can publish the official app; third-party forks publishing to stores should check ⚖️.
  - Contributions now come in under AGPL (inbound = outbound).

## Where the credit appears

| Place                                                           | What                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Every source file (`.ts`, `.tsx`, `.mjs`, `.js`, `.css`, `.sh`) | SPDX header: `AGPL-3.0-or-later`, copyright, "keep the Powered by NexaHeart credit: see NOTICE" |
| `LICENSE` + `NOTICE`                                            | Full AGPL-3.0 text; NOTICE holds the section 7 additional terms and the exact credit            |
| `packages/shared/src/credit.ts`                                 | One source for the name, URL, license and the text in 4 languages                               |
| App (web, iOS, Android)                                         | Welcome, sign-in, check-email, settings, privacy, terms, cookies, accessibility, suspended      |
| Admin dashboard                                                 | Footer on every page, including sign-in                                                         |
| Website                                                         | Footer                                                                                          |
| Emails                                                          | A last line in every email (sign-in, safety check-in alert, privacy notices)                    |
| API                                                             | `GET /v1/instance` returns `poweredBy {name, url, license, sourceUrl}`; startup log line        |
| Worker                                                          | Startup log line                                                                                |
| HTML                                                            | `<meta name="generator" content="NexaHeart">` (app web, admin, site)                            |
| `install.sh`                                                    | Banner                                                                                          |
| CI                                                              | `scripts/check-credit.mjs` fails the build when a header or a credit is missing                 |

`SOURCE_CODE_URL` (new, optional) sets where "Open source" points; the default is the upstream
repository. A modified version that people use over the network must point to its own source
(AGPL section 13) ⚖️.

## Additional terms (NOTICE)

Under section 7 of the AGPL:

- (b) You must keep the credit "Powered by NexaHeart · Open source" (or its translation into the
  interface's language), with a link to https://nexaheart.com. It goes in a reasonably visible
  place in each user interface (the app's welcome and settings screens, the admin dashboard) and in
  the emails the software sends. You must also keep the copyright and license notices in the source.
- (c) Modified versions must not claim to be the official NexaHeart project.
- (e) The license does not grant rights to the NexaHeart name or logo beyond this credit.

⚖️ The wording must be checked by a lawyer before the first AGPL release.

## Tests

- Unit tests:
  - `poweredBy` is in the instance response.
  - Every email ends with the credit.
- e2e: the credit is visible and its links work on the app's welcome and settings screens and on the
  admin sign-in, in all 4 languages; axe still reports 0 violations.
- CI: `pnpm check:credit`.

## Docs

README (license badge, license section), CONTRIBUTING (contributions under AGPL), INSTALL en/he FAQ
("Can I use my own name and logo?": yes, keep the credit), site, marketing, PLAN.md decision,
CHANGELOG, SELF_HOSTING (`SOURCE_CODE_URL`).

## Results

| Check                                 | Result                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` (includes `check-credit`) | ✅ headers on every source file, the credit in every required place                                                                                      |
| Unit tests                            | ✅ shared 41, api 39, mobile 21, worker 14, ai 53, admin 3                                                                                               |
| API integration tests                 | ✅ 144/144 (including `poweredBy`)                                                                                                                       |
| `pnpm --dir e2e credit`               | ✅ 120 checks: 6 public screens and "check your email" in en/he/ar/ru, the dashboard in he/en; links open nexaheart.com and the source; 0 axe violations |
| `pnpm --dir e2e privacy`              | ✅ the signed-in settings screen shows the credit in 4 languages                                                                                         |
| `e2e/a11y.ts`                         | ✅ keyboard, 320 px reflow and 200% text with the new footer, 4 languages                                                                                |
| Screenshots                           | `60-powered-by` in 4 languages; screens 01–16 retaken                                                                                                    |

## Known limitations

- Anyone with the code can technically delete the credit; the protection is the license term, which
  needs a lawyer's review before it's relied on ⚖️.
- App stores and GPL-family licenses: check before a fork publishes to the App Store ⚖️.
