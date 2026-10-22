# Phase 1.5: Your own instance (setup, branding, one-command site)

> Status: ✅ done (2026-10-21). 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: someone with a server and a domain can run `./install.sh`, open a link, claim the instance,
brand it, and have a working dating site (web app + moderation dashboard + API) over HTTPS.

## Scope

| #   | Deliverable                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Instance settings in the database** (`instance_settings`, single row): name, tagline, primary color, default language, sponsor link, operator name, contact email, logo. Environment variables stay as defaults; database values override them                                                              |
| 2   | **Claim the instance (first run)**: `install.sh` generates a one-time `SETUP_TOKEN` and prints it. The first person signs in normally, enters the token in the dashboard, and becomes admin. It works only while no admin exists, and is locked afterwards (`410`). Without a token, use the CLI from phase 4 |
| 3   | **Setup wizard** in `apps/admin`: claim → TOTP → branding → done. Afterwards a **Branding** page (admins only)                                                                                                                                                                                                |
| 4   | **Accessible branding**: the primary color is rejected unless white text on it has ≥ 4.5:1 contrast (WCAG AA). A dark-mode variant is derived automatically                                                                                                                                                   |
| 5   | **Logo**: upload → magic-byte check → ClamAV → re-encoded to WebP by the worker (EXIF stripped, same size limits as photos). Served publicly from `/v1/instance/logo`                                                                                                                                         |
| 6   | **App uses the branding**: name, tagline, logo, color across the app; the operator's name and contact in the legal pages and accessibility statement; browser title                                                                                                                                           |
| 7   | **One-command site**: a `web` image that builds the web app and the dashboard, served by **Caddy** with automatic HTTPS and the security headers; `docker compose --profile app up -d` runs everything behind one domain (`example.org`, `admin.example.org`, `api.example.org`)                              |
| 8   | `docs/SELF_HOSTING.md`: step by step, from an empty server to a live site, with backups and updates                                                                                                                                                                                                           |

## Data model

| Table               | Columns                                                                                                                                                            | Notes                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `instance_settings` | id = 1 (check), name, tagline, primary_color, default_locale, sponsor_url, operator_name, contact_email, logo_photo_id, setup_completed_at, updated_by, updated_at | Public data only. The contact email is published intentionally (legal pages) |

## API

| Endpoint                                | Who                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `GET /v1/instance`                      | 🔓 public; adds `logoUrl`, `operator`, `contactEmail`, `setupRequired` |
| `GET /v1/instance/logo`                 | 🔓 public, cached                                                      |
| `POST /v1/setup/claim` `{token}`        | 🔐 signed in; only while no admin exists; rate limited                 |
| `GET`/`PATCH /v1/admin/instance`        | 🛡️ admin + MFA                                                         |
| `POST`/`DELETE /v1/admin/instance/logo` | 🛡️ admin + MFA                                                         |

## Threat model additions

| Threat                                                   | Control                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Someone claims a fresh instance before the operator      | Claim needs `SETUP_TOKEN` (only in the server's `.env`), compared in constant time on hashes; rate limited; disabled once any admin exists |
| Token brute force                                        | ~190-bit random token (installer), 5 attempts per hour per account plus the global per-IP limit, audited failures                          |
| Malicious logo (malware, decompression bomb, SVG script) | Raster formats only (no SVG), same scan + re-encode pipeline, size limit                                                                   |
| Stored XSS through branding text                         | Plain text with length limits, rendered as text only (React/RN escape)                                                                     |
| Phishing through the sponsor link                        | `https://` only                                                                                                                            |
| Branding change by a moderator or stolen session         | Admin role + fresh TOTP, audited with the changed fields                                                                                   |

## Tests

Unit: contrast calculation and color derivation. Integration: claim with wrong token, right token,
second claim (410), claim after a CLI-created admin, rate limit, settings validation (contrast, https,
lengths), role/MFA enforcement, logo pipeline, `/v1/instance` overrides. E2E: setup wizard screenshots,
branded app screenshots, axe. Infra: build the `web` image and serve it through Caddy locally.

## Results

| Check                                  | Result                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests                             | shared +5 (WCAG contrast, dark-mode derivation for many colors, settings validation incl. `javascript:` and markup), admin 3                                                                                                                                                                                 |
| Integration tests                      | **71 passed** (5 new): wrong/right token, single use (410), closed after a CLI admin, session required, rate limit (5/h), branding validation, admin + TOTP only (moderators and members refused), logo pipeline (SVG refused, hidden until scanned, old file purged, removal)                               |
| Mutation tests                         | Removing the token comparison, the "no admin yet" check or the admin-only check each makes the suite fail                                                                                                                                                                                                    |
| Installer                              | `--domain` writes production settings (HTTPS URLs, CORS, `TRUST_PROXY`, `NODE_ENV`); rejects malformed domains; the API accepts the generated `.env`                                                                                                                                                         |
| Web server                             | The repository `Caddyfile` validated with Caddy 2.11.7 and run unchanged (paths and API address only) in front of a fresh, isolated stack on `dateos.test`: HTTPS for three hosts, CSP and HSTS on both sites, SPA deep links, path traversal answered with the app shell, CORS limited to the app's origins |
| Fresh-instance e2e (`e2e/instance.ts`) | Sign in → claim (wrong token refused) → TOTP → branding (a low-contrast color is refused with an explanation) → logo scanned and shown → member app branded in he/en, light and dark, with the operator in the accessibility statement and the community name as the browser title                           |
| axe-core WCAG 2.1 A/AA (9 new screens) | **0** after fixing one issue (two inputs both named "Brand color")                                                                                                                                                                                                                                           |

## Bugs found and fixed during this phase

1. **An empty `ACME_EMAIL` broke the whole web server configuration** (found by `caddy validate`). The setting is removed; Caddy needs no email for automatic certificates.
2. **The setup wizard jumped away on save**, so there was no confirmation and the logo step was skipped. It now stays, confirms, and offers "Continue to the dashboard".
3. **Two inputs shared the name "Brand color"** (color picker and text field), which is ambiguous for screen readers.
4. **The Hebrew operator sentence put a Latin name in the middle of the text**, which reads badly in right-to-left layout. It is now phrased as "operator: name".
5. **The self-hosting guide claimed uploads still work without ClamAV**, which is wrong with the default `MALWARE_SCAN=clamav`. Corrected, and the containers now get the Ollama address for the `ai` profile.

## Known limitations

- The full `web` Docker image could not be built in this development environment (Docker Hub answered 429). CI now builds it on every push, together with `install.sh --domain` and `caddy validate`.
- Branding is one language: the tagline is shown as written in every locale.
- Mobile store builds (icons, bundle id) are still manual through Expo EAS 📘.
- The logo belongs to the admin who uploaded it; if that account is deleted, the logo is removed too.
