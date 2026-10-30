# Phase 59: The community's own logo as the installed app's icon (v1.31)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.

## Why

Phase 57 made the web app installable with the community's **name and colour**, but the home-screen
icon is always NexaHeart's heart, even when the community uploaded its own logo in Branding. On a
phone, the icon is what members tap every day: it should be the community's.

## What changes

| Part                           | Change                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/instance/icons/:name` | `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png` made from the logo: centred on a white square, inside the safe zone (80 %; 60 % for the maskable one, which Android crops to a circle) |
| No logo                        | The same addresses redirect to the built-in icons (`/icons/…`), so nothing breaks                                                                                                                                 |
| Manifest (phase 57)            | With a logo, its icons point to `/brand-icons/…?v=<logo version>`: a new logo is a new address, so phones pick it up                                                                                              |
| Caddy, `index.html`            | `/brand-icons/*` on the app's domain is served from the API; the Apple touch icon (iPhone home screen) uses it                                                                                                    |

## Security and privacy

- The logo already passed the upload pipeline (malware scan, re-encoded to WebP, public by design).
  The icons are made from that clean file only, with sharp, in memory, at fixed sizes; nothing from
  the request reaches sharp except the choice among four names (allow-list).
- Cached in memory per logo version; `Cache-Control: public, max-age=86400` (the version changes
  the address).

## Accessibility

- The icon has no text to read; the manifest's `name` stays the accessible label.

## Tested for real

- **Integration** (in `instance.test.ts`): no clean logo yet → `302` to `/icons/icon-192.png`; with
  the logo: `icon-512` is a 512 × 512 PNG, white at the corner, the logo's colour in the middle and
  51 px from the edge (80 %), while the maskable one is white there (60 %, Android's safe zone); the
  Apple icon is 180 px; an odd name (`..%2Fsecret.png`) → 400; the manifest's icons are
  `/brand-icons/…?v=<logo version>`; after removing the logo, back to the redirect.
- **Caddy** (pinned image, this Caddyfile): `/brand-icons/icon-192.png?v=…` without a logo →
  `302 /icons/icon-192.png` → the built-in PNG; the config validates.
- **e2e** `pnpm --dir e2e pwa`: an admin (two-factor) uploads a wide logo; the worker scans it; the
  manifest's icons become the community's; the icon is a 512 × 512 PNG; **Chrome still finds the app
  installable** with them; then the rest of phase 57's checks (en, he); the logo is removed at the end.
- Unit (1 new): the manifest uses the logo's icons, and the built-in ones for an odd logo address.
- Picture: `docs/screenshots/showcase-brand-icon.png` (the logo, the icon, the icon as Android crops it).

## Order of work

1. Shared: `webManifest` uses the logo's icons when there is one (unit tests).
2. API: the icons route (allow-list, sharp, cache, redirect without a logo); integration tests (sizes,
   a white square, the redirect, unknown names refused).
3. Caddy `handle_path /brand-icons/*`; `index.html` Apple touch icon; dev server proxy; validated with
   the pinned Caddy image.
4. e2e `pwa` extended: upload a logo in the dashboard, the manifest's icons are the community's and
   Chrome still finds the app installable; screenshot of the generated icons.
5. Docs, PR, merge.
