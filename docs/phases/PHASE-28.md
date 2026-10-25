# Phase 28 (proposal): Communities that connect

> Status: ✅ **done**: 28a, 28b (2026-10-23), 28c (2026-10-24) and 28d (2026-10-25). Open: the ⚖️ items below and 📘 real devices. The owner delegated the decisions; chosen:
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

## 28b in detail (this step)

**Who takes part.** Only members who turn on Settings → "Partner communities". Turning it on is an
explicit consent (`federation`, versioned ⚖️) that lists the partners by name and says exactly what
they receive. It works both ways: you can see partners' members only if you can be seen. Turning it
off tells every partner to forget you and deletes your likes and matches there.

**Pseudonyms.** A member is known to each partner only by a random alias (22 characters), made the
first time they're shown to or act toward that partner: different for every partner, so two
partners can't link the same person, never the real id, and a new one after leaving and coming back.

**Discovery** (`POST /v1/federation/discover`, signed). The viewer's server sends the viewer's alias,
gender, who they want, age and age range, and the aliases to leave out (already liked, passed or
blocked). The partner returns up to 20 of its members who took part and pass **both ways** (gender,
interest, ages), are active, not paused, not incognito, onboarded, with a clean photo, and haven't
blocked this viewer. A card: alias, first name, age, gender, intention, bio, prompts, photos (ids
only), languages, verified. **Never:** email, location or distance, religion, lifestyle, accessibility
needs, voice, friends' takes, badges.

**Photos** go through the viewer's own server (`GET /v1/federated/photos/:partner/:photo` → signed
`GET /v1/federation/photos/:photo`): the member's phone never talks to another community, and the
partner checks the photo belongs to someone taking part.

**Likes and matches.** A like is sent signed (`POST /v1/federation/likes`, from alias to alias). The
receiving server matches it against its own member's earlier like; on a match both servers record it,
with the other person's first name and one photo. Matches appear in Matches under "From partner
communities". **Chat across communities is the next step (28c)**; until then the match says so.

**Blocks and unmatching.** A block hides the person here and ends any match on both sides
(`POST /v1/federation/unmatch`); the blocked alias is left out of every later discovery both ways.

**Ending.** Ending a partnership (either side) or withdrawing deletes the aliases, likes, passes and
matches with that partner.

### API (members)

| Method | Path                                       | What                                                          |
| ------ | ------------------------------------------ | ------------------------------------------------------------- |
| GET    | `/v1/federated/status`                     | joined or not; partners' names and privacy links              |
| POST   | `/v1/federated/join`, `/leave`             | the consent (versioned), and leaving (partners forget you)    |
| GET    | `/v1/federated/deck`                       | cards from every active partner (needs the consent)           |
| POST   | `/v1/federated/interactions`               | `{ partnerId, alias, kind: like/pass/block }` → `{ matched }` |
| GET    | `/v1/federated/matches`                    | matches from partner communities                              |
| DELETE | `/v1/federated/matches/:id`                | unmatch (tells the partner)                                   |
| GET    | `/v1/federated/photos/:partnerId/:photoId` | a partner's photo, through this server                        |

### Tests

Two complete servers in one integration test (each with its own database and Redis), talking to
each other through the signed API: discovery both ways with the filters, photos, a mutual like
becoming a match on both sides, a pass and a block leaving people out, unmatch, withdrawing, and
ending the partnership. e2e in the app in four languages.

## 28b results

- **Built:** the `federation` consent (versioned ⚖️; the generic consent route refuses it, so leaving
  always tells partners); `federation_aliases`, `federation_decisions` and `federation_matches`
  (migration `0033_federated_discovery`); the signed endpoints `discover`, `likes`, `unmatch`,
  `forget` and `photos/:id`; the members' API (table above); in the app: **Partner communities**
  (what's shared and with whom, join and leave), a **Partner communities** deck in Discover (the
  card says which community; like, pass, block with a confirmation) and **From partner
  communities** in Matches (unmatch; "chat is coming"); four languages. The data export includes
  the aliases, decisions and matches.
- **Kept out of discovery across communities:** anyone who hasn't joined, paused, on a break,
  incognito, without a clean photo, or who blocked the viewer; people the viewer already decided on.
- **Ends on the other side too:** a block or unmatch (`unmatch`), leaving and deleting the account
  (`forget`), a suspension (matches end), and ending the partnership (everything with that partner
  is deleted on both servers).
- **Safety of what comes back:** a partner's answers are untrusted: every card and like answer is
  checked against a schema with length limits, answers are capped (512 KB, photos 6 MB, only
  `image/*`, served back as `image/webp` with `nosniff`), and a slow partner is skipped after 4 s.
  Likes count toward the same daily limit as likes here.
- **Tests:**
  - Integration: 5 new with **two complete servers** in one test (each its own database, Redis
    and buckets; requests go through the real signed API): both-way filters (gender, interest,
    ages), only members who joined, nothing but the card, a pseudonym, photos through the home
    server, incognito hidden; a mutual like is a match on both sides, already decided is refused,
    a pass leaves out, a block ends the match on both and hides both ways; unmatch tells the
    partner; leaving, deleting the account and ending the partnership delete what crossed on both
    servers; unsigned requests, a malformed signed request, the generic consent route and an old
    consent version are refused. All 229 integration tests pass.
  - e2e `pnpm --dir e2e federated-discovery` between **two real servers** (each with its own
    database and worker), in English, Hebrew, Arabic and Russian: join (needs the consent ticked),
    the deck with the photo through community A, a like back is a match on both servers, unmatch
    reaches B, leaving makes B forget her; axe 0 violations. Screenshots `102-partners-join`,
    `103-partners-deck`, `104-partners-match`.
- **Found and fixed:** "No matches yet" showed next to a match from a partner community.
- **Still to check:** ⚖️ the consent text and the privacy policy lines (special-category data sent
  to another operator, possibly abroad); ⚖️ a partner that can't be reached when someone leaves keeps
  what it had until 28d adds retries; 📘 real devices.

## 28c in detail (this step)

**Text chat between a member here and a match from a partner community.** Voice, photos and calls
stay local for now (they need media through both servers).

- **Sending:** the app sends to its own server, which sends the message signed to the partner
  (`POST /v1/federation/messages`: from alias, to alias, a message id, the text). It's stored here
  only once the partner accepted it; if the partner can't be reached the member is told and can
  retry (the same message id, so never twice). Before sending, the app asks "Are you sure?" for
  hurtful words, as in local chats.
- **Receiving:** the partner's server checks the match still exists on its side (else the match
  ends here too), stores the message, runs **its own** filters (hurtful messages arrive hidden
  behind "show anyway", scam warnings), and tells its member live and with a content-free push.
- **Each server keeps its own member's side**: the messages they sent and received in that match.
  Nothing is kept about anyone else. No read receipts or typing across communities.
- **Ends with the match:** unmatch, block, leaving, account deletion, suspension and ending the
  partnership delete the conversation on this server, and the partner is told (as in 28b) so it
  deletes its side ⚖️ (a partner that can't be reached keeps its copy until 28d's retries).
- **Data export:** the messages the member sent.

| Method | Path                                         | What                                   |
| ------ | -------------------------------------------- | -------------------------------------- |
| GET    | `/v1/federated/matches/:id/messages`         | the conversation (newest 50, `before`) |
| POST   | `/v1/federated/matches/:id/messages`         | `{ text, clientId }` → the message     |
| POST   | `/v1/federation/messages` (server to server) | signed; `{ delivered }`                |

## 28c results

- **Built:** `federation_messages` and the match's own `read_at` (migration `0034_federated_chat`);
  the signed `POST /v1/federation/messages`; the members' chat API; in the app a chat screen for
  matches from partner communities (text only, with a note saying the other community keeps its
  side), **Chat with …** with the latest message and unread count in Matches, live updates, and a
  content-free push (`partner_message`) that opens the chat. Four languages; the data export
  includes the messages the member sent.
- **Safety:** "Are you sure?" before a hurtful message (checked here before anything leaves); the
  receiving community runs its own filters (hurtful messages arrive hidden, scams flagged). A
  message is stored only once the other side accepted it; a retry with the same id is never sent
  twice; if the other side no longer has the match, it ends here too.
- **Tests:**
  - Integration: 6 new with two complete servers: a message crosses and both keep their own copy
    (the same id), unread and push; a retry is sent once; the receiving side's own filters; ending
    with the match on both sides; a match the other side lost ends when writing; only the two
    people in the match, only signed, length limit. All 235 integration tests pass.
  - e2e `pnpm --dir e2e federated-chat` between two real servers in English, Hebrew, Arabic and
    Russian: Noa writes in the app, it arrives at B; Dan's answer and a scam warning appear live
    for Noa; when Dan unmatches her open chat ends; axe 0 violations. Screenshot `105-partners-chat`.
- **Found and fixed:** Drizzle writes a column without its table inside a subquery, so the
  latest-message preview matched the wrong id (now spelled out); a member who isn't in a match got
  403 instead of 404; a Latin name in a right-to-left header sat on the wrong side.
- **Still to check:** ⚖️ messages stored by another operator (the agreement must cover them, and
  deletion when a partner can't be reached waits for 28d's retries); 📘 real devices.

## 28d in detail (this step)

- **Reports across communities.** A member reports someone from a partner community (from the card
  or the chat), with a category and optional details; reporting also blocks, unless they choose
  not to. Their server sends it signed (`POST /v1/federation/reports`) with the last messages of
  their chat as evidence (copied by the server, never taken from the app). The reported person's
  community puts it in **its own** moderation queue ("from a member of …"), handles it with its
  own rules, and sends back only that it was **reviewed** (`POST /v1/federation/report-outcomes`),
  never what was decided. Urgent categories alert that community's staff, as for local reports.
- **Suspending a partner.** An admin can suspend a partnership in one click (and resume it): nothing
  crosses either way while suspended (their requests are refused, their members disappear here),
  but nothing is deleted, unlike ending it. The Partners page shows, per partner, reports sent and
  reviewed, and reports received, to help decide.
- **Deletion with retries (an outbox).** Telling a partner to forget someone, to end a match or
  about a report, and the outcome of a report, are kept in an outbox when the partner can't be
  reached, and retried with a growing pause (1 minute up to 6 hours) for up to 7 days; then given up
  and noted in the audit log. Partners still receive these while suspended.
- **Audit:** reports sent and received, outcomes, suspensions, and outbox give-ups (ids only).
- **Later:** exchanging lists of banned photo hashes between partners (phase 21) ⚖️.

## 28d results

- **Built:** `federation_reports_out`, `federation_outbox`, and `reports.partner_id` /
  `partner_report_id` (migration `0035_federated_safety`); the signed `reports` and
  `report-outcomes` endpoints; `POST /v1/federated/reports`; `suspend` / `resume` (admins only);
  the outbox, retried every minute by one API instance (a Redis lock). In the app: **Report** on a
  partner's card and in the chat, with what happens to the report spelled out; in the dashboard:
  the reporter shown as "a member of …" on such a report, **Suspend** / **Resume** and the report
  and outbox counts on Partners. Four languages in the app, English and Hebrew in the dashboard.
- **Tests:**
  - Integration: 5 new with two complete servers: a report reaches the reported person's queue
    with the chat as evidence and no reporter, urgent alerts staff there, a second report is
    refused, the decision comes back only as "reviewed"; suspending stops everything both ways
    without deleting, only admins can resume; the outbox keeps a deletion while the partner is
    down, retries with a longer pause, delivers when it's back; it gives up after 7 days with an
    audit entry; unsigned, malformed and unknown-partner reports are refused. All 240 integration
    tests pass.
  - e2e `pnpm --dir e2e federated-safety` between two real servers: Noa reports Dan from the chat
    (4 languages), B sees it with the evidence, reviews it, A learns it was reviewed; A's dashboard
    shows a report from B's member, suspends and resumes (English and Hebrew); axe 0 violations.
    Screenshots `106-partners-report`, `admin-19-partner-report`, `admin-20-partner-suspended`.
- **Found and fixed:** a block always sent an "unmatch" to the partner even without a match, which
  filled the outbox while a partner was down; now only a match that ended is told.
- **Known limits:** someone who leaves partner communities can't be reported from the other side
  afterwards (their alias is gone, by design); ending a partnership while the other side is down
  isn't retried (they notice when their requests are refused). ⚖️ Moderators of one community act
  on evidence from another; the agreement should say how reports are handled and how fast.
