# Phase 2: Discovery, reciprocal AI matching, Daily Picks, matches

> Status: in progress. 📘 = verify against official docs, ⚖️ = needs legal review.

## Scope

| #   | Deliverable                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Approximate location**: the client sends coordinates, the server snaps them to a ~1 km grid and **stores only the snapped cell**. Distances leave the API only as buckets (`<2`, `<5`, `<10`, `<25`, `<50`, `50+` km)                                                                          |
| 2   | **Candidate generation** (SQL, PostGIS): both users must fit each other's gender, age, distance and intention preferences. Excludes self, blocked users in either direction, existing interactions and suspended accounts                                                                        |
| 3   | **Embeddings** (`packages/ai`): profile text (bio + prompt answers + intention; never name, age, gender or photos) → vector. Providers: `hashing` (default, offline, lexical) and `ollama` (local semantic model, e.g. `paraphrase-multilingual`). Computed by the worker when a profile changes |
| 4   | **Reciprocal scoring** (pure, unit-tested TypeScript): compatibility × the estimated chance the _other_ person also likes you × fairness (exposure cap, new-user boost). Each result carries explainable reason codes                                                                            |
| 5   | **Daily Picks**: 10 per day, computed once per user per day and stored                                                                                                                                                                                                                           |
| 6   | **Discover feed** + **interactions**: like / pass / like-with-comment on a specific photo or prompt. A mutual like creates a match. Daily interaction cap (anti-bot)                                                                                                                             |
| 7   | **Likes You** (free for everyone), **Matches**, **unmatch**, **block** (safety baseline; reporting comes in phase 4)                                                                                                                                                                             |
| 8   | **Public profile view** and **photo access** widened from owner-only to "viewer is allowed to see this profile"                                                                                                                                                                                  |
| 9   | Mobile: location onboarding step, tabs (Discover, Picks, Likes, Matches, Profile), profile cards with buttons for every action (no gesture-only actions), "why we matched", match screen                                                                                                         |
| 10  | Demo seed (fictional profiles, illustrated photos, dev only) + new screenshots + `docs/MATCHING.md` (the algorithm, published openly)                                                                                                                                                            |

## Data model

| Table                | Columns (main)                                                                                            | Retention                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `locations`          | user_id PK, geo `geography(Point)` **snapped**, updated_at                                                | replaced on update; deleted with the account or on request |
| `profile_embeddings` | user_id PK, embedding `vector(768)`, model, updated_at                                                    | recomputed on change                                       |
| `interactions`       | actor_id, target_id, kind (like/pass), item_type/item_id, comment ≤300, created_at; unique(actor, target) | account lifetime ⚖️                                        |
| `matches`            | user_a < user_b, created_at, unmatched_at, unmatched_by                                                   | account lifetime                                           |
| `blocks`             | blocker_id, blocked_id                                                                                    | account lifetime                                           |
| `daily_picks`        | user_id, candidate_id, served_on, score, reasons                                                          | 30 days                                                    |
| `impressions`        | viewer_id, candidate_id, surface, created_at                                                              | 30 days (fairness counters)                                |

## API

| Endpoint                                    | Auth | Notes                                                                       |
| ------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| `PUT /v1/me/location` `{lat,lng}`           | 🔐   | requires the `location` consent; raw coordinates are never stored or logged |
| `DELETE /v1/me/location`                    | 🔐   | stops discovery                                                             |
| `GET /v1/discover?limit=`                   | 🔐   | ranked candidates, logs impressions                                         |
| `GET /v1/picks/today`                       | 🔐   | idempotent per day                                                          |
| `GET /v1/profiles/:id`                      | 🔐   | 404 unless the viewer may see the profile                                   |
| `POST /v1/interactions`                     | 🔐   | `{targetId, kind, itemType?, itemId?, comment?}` → `{matched, matchId?}`    |
| `GET /v1/likes`                             | 🔐   | people who liked me (no paywall)                                            |
| `GET /v1/matches`, `DELETE /v1/matches/:id` | 🔐   | unmatch                                                                     |
| `POST /v1/blocks` `{userId}`                | 🔐   | also unmatches                                                              |

## Threat model additions

| Threat                                                       | Control                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trilateration (faking your own location to pinpoint someone) | Only grid cells are stored, and distances are bucketed from cells, so the best an attacker can learn is a ~1 km cell                                                      |
| Enumerating or liking arbitrary users by ID                  | Interactions and profile views require the target to pass the same mutual-visibility rules as discovery; otherwise 404                                                    |
| Like-bots / spam                                             | Daily interaction cap; comment length limit; rate limit                                                                                                                   |
| Blocked user still visible                                   | Blocks are excluded in both directions in every query (discovery, likes, matches, profiles, photos)                                                                       |
| Bias in ranking                                              | No ranking by attractiveness or "Elo". Protected traits are not used as features (only as filters the user explicitly chooses). Algorithm published in `docs/MATCHING.md` |
| Prompt injection via bio                                     | Embeddings only, no LLM generation in this phase                                                                                                                          |

## Tests

- Unit: grid snapping and distance buckets, scoring components, reasons, fairness, hashing embeddings.
- Integration: mutual filters (gender, age, distance, intention), blocks hide in both directions, like→match, unmatch, interaction on non-visible user → 404, photo access for viewers vs strangers, raw coordinates never stored, daily picks idempotent, daily cap.
- E2E: screenshots of the new screens + axe-core audit.
