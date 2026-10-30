# Phase 55: Short outages without losing anyone (v1.28)

> Status: ✅ done (2026-10-30). 📘 = verify against official docs, ⚖️ = needs legal review.

## The problem (reproduced)

Phase 53 made updates easy, and an update restarts the API: for a minute or two `api.DOMAIN`
answers Caddy's empty `502`. Reproduced on the web app with a signed-in member and the API answering
502:

- Before: the member is on **Discover**. Reload while the API is down: **the welcome (sign-up) page**,
  as if signed out. When the API is back they stay there.
- Cause: better-auth keeps the session on a failed _refresh_, but on the _first_ load a failed
  `get-session` leaves `data: null`, and four places (`app/index.tsx`, `(tabs)/_layout.tsx`,
  `onboarding/_layout.tsx`, `RequireSession`) send "no session" to `/welcome`.
- Already open: every screen's own "Something went wrong" with no reason, and nothing refreshes by
  itself when the server is back. The dashboard: the same generic error on every page.

## What changes

| Where                | Change                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caddy (`api.DOMAIN`) | A 502/503/504 from the API becomes `503` with `Retry-After: 30` and the API's error shape with its own code, `SERVER_RESTARTING`, with CORS for the app and the dashboard so the browser can read it                   |
| App: opening it      | No session _because the server didn't answer_ (not a 401) → "{community} can't be reached right now" with what it likely is (an update, a restart), checks every 10 s and carries on by itself, and a Try again button |
| App: while using it  | A polite banner at the top (`role="status"`) when requests fail that way; checks `/health` every 10 s; when it answers, the banner goes and the open screens reload                                                    |
| App: requests        | `apiFetch` no longer throws a parse error on a non-JSON body (an HTML error page from a proxy)                                                                                                                         |
| Dashboard            | The same: "The server can't be reached right now (an update or a restart?)", retrying by itself                                                                                                                        |

A 401 still means signed out, and still goes to the welcome page.

### Outage or a real error?

The API itself answers 503 `SERVICE_UNAVAILABLE` when a feature is off (calls, voice, connecting
communities) and 502 `BAD_GATEWAY` when a partner community doesn't answer. Those are not outages.
The rule (`isUnavailableAnswer` in the app, `isUnreachable` in the dashboard): **no answer at all, a
502/503/504 without an API error in it, or Caddy's `SERVER_RESTARTING`**. An error with the API's
own code is shown as before.

## Security and privacy

- No new data, no new requests except `GET /health` (public, no cookie needed, already excluded from
  rate limits) while the server is unreachable.
- Caddy's CORS for the error answer: only `https://DOMAIN` and `https://admin.DOMAIN`, the same
  origins the API allows (install.sh's `CORS_ORIGINS`).

## Accessibility

- The banner and the unreachable screen are announced once (`role="status"`, polite), not on every
  retry; the retry button is a real button with a name; no colour-only meaning; 4 languages; RTL.

## Tested for real

- **Caddy** (the pinned `caddy:2.11.7-alpine`, this Caddyfile, `DOMAIN=nexa.localhost`): `validate`
  OK; API up → 200 through; API stopped → `503`, `Retry-After: 30`, `SERVER_RESTARTING`, CORS for
  `https://nexa.localhost` only (a foreign origin and the look-alike `https://nexaXlocalhost` get
  none); an upstream that answers its own `502 BAD_GATEWAY` → passed through unchanged.
- **e2e** `pnpm --dir e2e outage` (en, he), signed-in member: opening the app with no answer → the
  "can't reach" screen, not the welcome page; server back → on to Discover by itself, no reload;
  Caddy's 503 while using the app → the banner, still in the app; back → the banner goes; signed out
  (401) → the welcome page still. Dashboard: the "can't be reached" box, not sign-in; back → the
  reports page by itself. axe 0.
- Unit (3): outage vs the API's own errors, for our errors and better-auth's.
- Regression: `preview`, `reauth`, `admin-updates` e2e; integration 353/353.
- Screenshots: `131-server-unreachable`, `132-server-banner`, `133-admin-server-unreachable` (en, he).

Found on the way: the first screenshot showed the banner on top of the "can't reach" screen (the same
thing twice); the banner is now only for a signed-in member, the screen covers the rest.

### Known limits

- The site itself (web app, dashboard) is served by the same Caddy container, which is rebuilt and
  restarted by an update too: for a few seconds nothing answers at all. A page already open keeps
  working; one opened in those seconds needs a reload.
- Native apps don't need the CORS part; they read the 503 directly. 📘 Not yet tried on a device.

## Order of work

1. Mobile: `lib/server-status.ts` (store + `isUnavailable`), `apiFetch`, `ServerUnreachable` screen,
   `ServerStatusBanner`, the four session gates; i18n ×4; unit tests.
2. Dashboard: unreachable state in `ErrorBox` with auto-retry; en + he.
3. Caddy `handle_errors` on `api.DOMAIN`; validate with the pinned Caddy image.
4. e2e `pnpm --dir e2e outage` (en, he): opening the app while down, the banner while using it,
   recovery without a reload; the dashboard; axe 0; screenshots.
5. Docs (INSTALL en/he, SELF_HOSTING, CHANGELOG), PR, merge.
