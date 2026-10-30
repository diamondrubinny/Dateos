# Phase 57: A real installable web app (PWA) that opens even when the server doesn't (v1.30)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.

## The gap (checked)

`docs/PLAN.md` promises the web app as a **PWA**, the free alternative to the app stores. The built
site has neither part of one:

- **No web app manifest**: `dist/index.html` links none, so phones offer no "Add to Home screen" /
  "Install app" with the community's name and icon.
- **No service worker**: when the site's own server restarts (an update: phase 55's known limit) or
  the phone's connection drops, opening the app shows the browser's error page, not the app.

## What changes

| Part                    | Change                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest                | `GET /manifest.webmanifest` on the app's own domain: the **community's** name, tagline, colours and language direction (from the dashboard's branding), standalone display, icons. Served by the API, proxied by Caddy     |
| Icons                   | 192, 512, maskable 512 and the Apple touch icon (180), generated from `assets/icon.png`                                                                                                                                    |
| Service worker `/sw.js` | Generated at build with the list of that build's files. Keeps the **app's own code** (the same for everyone) so the app opens without the server; then phase 55's "can't reach" screen takes over and carries on by itself |
| Updates of the app      | Pages are fetched from the network first, so a new version shows on the next open; the old copy is removed when the new one is ready                                                                                       |

### What the service worker never touches

- **Nothing from the API** (`api.DOMAIN`, another origin): profiles, messages, photos are never
  cached by it. Only same-origin `GET`s for the app's own files.
- No push here (phase 3b decides push separately), no background sync, no tracking.

## Security and privacy ⚖️

- Cache Storage holds the public app code only, identical for every visitor; listed on the "Privacy
  & cookies" page and in the cookie policy as strictly necessary (so the app opens), removed by
  clearing site data.
- The manifest carries only public branding (already public at `/v1/instance`).
- `sw.js` is served `no-cache` so a fixed build reaches people; scope `/` (the app's origin only).
- CSP unchanged: `script-src 'self'` covers the worker, `manifest-src 'self'` the manifest; no inline
  script (registration is in the app's code).

## Accessibility

- The manifest's `lang` and `dir` follow the community's default language (Hebrew → `rtl`).
- `theme-color` from the brand; the offline experience is phase 55's accessible screen, not a new one.

## Tested for real

- **Caddy** (pinned `caddy:2.11.7-alpine`, this Caddyfile, the built app): `/manifest.webmanifest`
  → the API's manifest (`application/manifest+json`, here Hebrew → `dir: rtl`); `/sw.js` →
  `Cache-Control: no-cache`; an app route still falls back to the app; icons served. The first
  try put the manifest behind the app's `try_files` (it would have become `index.html`); fixed with
  separate `handle` blocks.
- **e2e** `pnpm --dir e2e pwa`: **Chrome's own installability check passes** (CDP
  `Page.getInstallabilityErrors`, in a normal profile: Chrome never offers installing in an
  incognito-like one); the manifest has no errors and carries the community's name; the worker
  controls the app; one copy, this build's (an older one is removed); 69 files kept, all the
  app's own, **nothing from the API**; with the connection off the app opens and shows the "can't
  reach" screen, not the welcome page, then carries on to Discover when it's back (en, he). axe 0.
- **Privacy e2e**: Cache Storage is checked against the published inventory, like cookies and
  local storage.
- Unit (3): the manifest's name, short name, direction, colour, icons. Integration: the manifest
  follows the branding set in the dashboard.
- Regression: `outage`, `privacy`.
- Screenshot `137-pwa-offline` (en, he).

### Known limits

- 📘 Not yet tried on real phones (Android install prompt, iOS "Add to Home Screen" and its
  standalone mode).
- The home-screen icon is NexaHeart's; a community logo (any shape, WebP) isn't used as the app icon
  yet.

## Order of work

1. Shared `webManifest(info)` (unit tests); API route; Caddy proxy and `sw.js` headers.
2. Icons; `scripts/web-pwa.mjs` after `expo export`: tags in `index.html`, `sw.js` with the build's
   files; registration in the app (web only, production builds).
3. Storage inventory + cookie policy (4 languages).
4. e2e `pnpm --dir e2e pwa`: the manifest is valid and installable (Chrome's own check), the worker
   controls the page, the API is never cached, the app opens with the site down and shows the
   "can't reach" screen, then carries on; a new build replaces the old copy. axe 0.
5. Docs, PR, merge.
