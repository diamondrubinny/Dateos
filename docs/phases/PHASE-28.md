# Phase 28 (proposal): Communities that connect

> Status: ✅ **28a done** (2026-10-23); 28b (discovery across communities) next. The owner delegated the decisions; chosen:
> **A (partnerships)**; **discovery and matching first**, chat across communities later (28c);
> members **off by default**, and federation itself off on a server until its admin turns it on.
> 📘 = verify against official docs, ⚖️ = needs legal review.

Every NexaHeart community runs its own server. That is good for privacy and control, but a small
community (a city's LGBTQ+ group, a religious community, new immigrants) may be too small to find
anyone. The competitive analysis (§3.7) lists **connected niche communities** as something nobody
offers. This phase lets two communities that trust each other open their doors to each other's
members, **only for members who choose it**.

## The options

| Option                                          | How it works                                                                                            | For                                                                                                                  | Against                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Partnerships (recommended)**               | Two admins agree to connect their communities. Servers talk directly, signed with keys. Members opt in. | Each community stays in control; nothing public; no central server; a clear legal relationship between two operators | Each partnership is set up by hand; no network effect beyond partners                                                                                |
| B. Open federation (ActivityPub, like Mastodon) | Any server can follow any other                                                                         | Large network, an existing standard 📘                                                                               | Public by default; profiles copied to servers you don't know; spam and abuse from unknown servers; deletion can't be guaranteed. Wrong for dating ⚖️ |
| C. A central directory                          | One shared server matches people across communities                                                     | Simple discovery                                                                                                     | Becomes the central company the project avoids; one target for abuse and data requests                                                               |
| D. Portable profile only                        | A member moves or copies their profile to another community (export, import)                            | Small, no live connection                                                                                            | No discovery across communities; the small-community problem stays                                                                                   |

**Recommendation: A**, built in steps, with D as a small bonus later.

## How A would work

### 28a. Partnerships and trust

- Each server gets a signing key (Ed25519), published with its name, address and policy at
  `/.well-known/nexaheart` 📘.
- An admin invites another community by address; the other admin accepts. Both see each other's
  name, rules, contact and privacy policy before agreeing. Either side can end it at any time;
  ending it removes the other side's members from discovery at once.
- Every server-to-server request is signed and checked (key, time, nonce), over HTTPS only, through
  the same SSRF guard as the integrations (phase 24).
- ⚖️ The two operators become **joint controllers** (GDPR Art. 26) or controller-to-controller for
  the shared data; they need a written agreement. The dashboard shows a template and won't activate
  a partnership until both admins confirm it's signed.

### 28b. Discovery and likes across communities

- **Members opt in:** Settings → "Show me to partner communities" (off by default), with the list of
  partners and exactly what they receive. Turning it off withdraws the profile from partners.
- **What crosses:** a "card": first name, age, intention, bio, prompts, photos (served through the
  home server, never copied), languages, the verified and met badges. **Never:** email, exact
  location, religion, accessibility needs, messages, reports.
- **Matching both ways** needs gender and who someone is interested in (sensitive ⚖️). The viewer's
  server sends only the filter (age range, genders wanted); the partner returns only people who pass
  both ways. Distance: the city or region the partner declares, never coordinates.
- A like goes to the person's home server; a mutual like creates the match on both servers.
  Blocks always apply across both, and a block ends the match on both sides.

### 28c. Chat across communities

- Messages go server to server and are stored on both (each member's data stays with their own
  community too). The same filters (harm, scam) on both sides.
- Voice, photos and calls: in a later step (they need media proxying).

### 28d. Safety, moderation and deletion

- A report goes to **the reported person's home community**, with the reporter's evidence; the
  reporter's community is told the outcome (resolved, without details).
- A partner that ignores reports or serves abuse can be **suspended** by one click; shared hash
  lists of banned photos and emails (phase 21) can be exchanged between partners.
- **Deletion:** when someone deletes their account or withdraws, their home server tells every
  partner to delete their card, likes and messages; partners confirm. ⚖️ The member is told that a
  partner's copy of chat messages is deleted on request, not instantly.
- Every cross-community action is in both audit logs (ids only).

## Risks

- **Legal** ⚖️: joint controllership, sensitive data (orientation) sent to another operator, possibly
  across borders (DPA, SCCs), and minors (age verification differs per community).
- **Trust**: a partner could misuse what it receives. Partnerships are explicit, limited to
  what is listed above, and revocable; we can't technically stop a malicious operator from keeping
  what it was sent: the member must be told so plainly.
- **Complexity**: versioned server-to-server API, retries, partial outages, clock skew. Each step
  ships with tests that run two servers.

## Order of work (if approved)

1. 28a: keys, `/.well-known`, partnership invitations in the dashboard, signed requests.
2. 28b: opt-in, federated cards and discovery, likes and matches, blocks.
3. 28c: text chat across communities.
4. 28d: reports, suspension, deletion propagation; legal templates.

Each step is its own PR, with two-server integration tests and e2e in four languages.

## Decisions (made 2026-10-23)

1. **Option A**, partnerships.
2. **Discovery and matching first** (28b); text chat across communities after that proves itself
   (28c).
3. **Off by default** for members; `FEDERATION=off` by default for servers.
4. Legal review of the joint-controller agreement before any partnership goes live ⚖️: the dashboard
   asks both admins to confirm it's signed before a partnership becomes active.

## 28a in detail (this step)

- **Keys:** an Ed25519 key pair per server, made on first use; the private key is stored encrypted
  with `INTEGRATIONS_KEY` (phase 24), so federation needs that key.
- **`GET /.well-known/nexaheart`** (public): `{ version, name, url, publicKey, contact, privacyUrl }`.
  Only when `FEDERATION=on`.
- **Signed requests** between servers: headers `x-nexaheart-origin`, `-date`, `-nonce`, `-signature`
  (Ed25519 over method, path, origin, date, nonce and the body's SHA-256). Checked: a known (or, for
  an invitation, freshly fetched) key, at most 5 minutes of clock skew, a nonce never seen in the
  last 10 minutes (Redis).
- **Server-to-server API** (signed): `POST /v1/federation/invitations`, `POST /v1/federation/accept`,
  `POST /v1/federation/end`, `GET /v1/federation/ping`.
- **Dashboard → Partners** (admins only, moderators read): invite a community by its API address
  (after confirming the agreement), see invitations that arrived with the other community's name,
  contact and privacy policy, accept (after confirming the agreement), test, end. Everything in the
  audit log.
- **No member data** crosses in 28a: only the communities' public names, addresses and keys.
- Outgoing requests use the integrations' SSRF guard (https only, no private networks unless
  `INTEGRATIONS_ALLOW_PRIVATE`, no redirects, timeouts).

## 28a results

- **Built:** `federation_keys` and `federation_partners` (migration `0032_federation`), the public
  identity, signing and verification (`apps/api/src/lib/federation-sign.ts`), the server-to-server
  endpoints, the admin endpoints and the **Partners** page (English and Hebrew; moderators read
  only), docs and `.env.example`.
- **Tests:**
  - Integration: 7 new, against a fake partner that checks every signature with our published
    key: identity and a sealed key; invite → signed invitation → their accept → active → signed
    ping; an invitation that arrives → accept → end both ways; refused: unsigned, tampered body,
    6 minutes old, replayed nonce, claiming to be us, another key, inviting ourselves; a failed
    invitation is removed with the reason; at most 20 invitations wait; off by default.
  - e2e `pnpm --dir e2e federation` between **two real servers** (A on :4000, B on :4100 with its
    own database): A invites from the dashboard, B accepts, A tests the signed ping, A ends it and
    B sees it ended; English and Hebrew; axe 0 violations. Screenshot `admin-18-partners`.
- **Found and fixed:** anyone with a domain can sign an invitation, so at most 20 may wait for an
  admin; an invitation that the other side refuses is removed instead of left half-made.
- **Still to check:** ⚖️ the agreement template between operators; 📘 key rotation (not built: a
  new key means ending and re-inviting partners).
