# Performance

Measured on 2026-10-21 with `e2e/load.ts` against a separate database of **5 000 members**
(profiles, photos, approximate locations around Tel Aviv, 768-dimension embeddings, ~100 000 likes).
One API process and PostgreSQL shared **4 vCPUs** with the rest of the stack (Redis, object storage,
ClamAV, the worker). Each member is paced below its per-member limits, so no request was refused.

## Results

| Endpoint                         | Load                      | p50   | p95   | p99   |
| -------------------------------- | ------------------------- | ----- | ----- | ----- |
| `GET /v1/discover` (10 profiles) | 60 members, 24 req/s      | 41 ms | 62 ms | 79 ms |
| `POST /v1/matches/:id/messages`  | 60 members, 24 req/s      | 12 ms | 16 ms | 19 ms |
| `GET /v1/matches`                | 60 members, 24 req/s      | 9 ms  | 13 ms | 17 ms |
| `POST /v1/matches/:id/messages`  | 200 members, 80 req/s     | 9 ms  | 13 ms | 19 ms |
| `GET /v1/discover`               | 200 members, **80 req/s** | 1.6 s | 2.2 s | 2.3 s |

Targets (phase 7): discovery p95 < 300 ms and sending p95 < 100 ms at normal load: **met**.

**Capacity.** Discovery is the expensive request: one call ranks up to 300 candidates in a single
query (visibility rules in both directions, distance, embeddings, activity signals). On this machine it
saturates at about **70–80 discovery requests per second**, after which requests queue. For scale: if
every one of 5 000 members opened discovery 20 times a day, the average would be about 1 request per
second and a busy evening perhaps 10. Chat stays fast under the same load.

## What was changed

| Change                                                                                                                                                                                                | Effect                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| The candidate query runs as a **named prepared statement** with a stable text (the list of excluded ids is one array parameter). Planning it took 27 ms, longer than half of the 42 ms it took to run | p50 55 → 41 ms, p95 78 → 62 ms; saturation 67 → 80 req/s |

The query plan uses indexes for every lookup (profiles of the viewer, locations, embeddings, photos,
interactions by actor and target, matches by both users, impressions by candidate).

## Run it yourself

```sh
cd e2e
pnpm load seed                      # creates <database>_load with MEMBERS=5000 (override with MEMBERS=…)
# an API on that database, with sign-in rate limits off (NODE_ENV=test) and its own Redis database:
DATABASE_URL=…/nexaheart_load REDIS_URL=…/4 PORT=4200 PUBLIC_API_URL=http://localhost:4200 \
  NODE_ENV=test RATE_LIMIT_MAX=100000 pnpm --dir ../apps/api exec tsx --env-file=../../.env src/server.ts
API_URL=http://localhost:4200 VIEWERS=60 pnpm load run
```

The run exits with an error when a target is missed.

## Scaling further

- More API processes behind the proxy (the API is stateless; realtime events and presence go
  through Redis), with `MIGRATE_ON_START=false` on all but one.
- PostgreSQL on its own machine; a read replica for discovery is possible because it only reads.
- Above ~50 000 members in one area: limit candidates with the vector index first (pgvector HNSW) and
  cache daily picks; not needed at the sizes measured here.
