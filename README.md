# Dateos

**Free, open-source, privacy-first dating platform that anyone can self-host.**
Native iOS/Android and web from one codebase, reciprocal AI matching, and safety built in.

- 🆓 Free forever: no premium tier, no paywalls, no ads. MIT licensed.
- 🏠 Run your own instance for your city or community, with your own branding.
- 🤖 AI matching and assistance that runs locally by default (no data sent to third parties).
- 🛡️ Safety first: verification, harassment and scam detection, and approximate location only.
- ♿ Accessible and RTL-ready (Hebrew/English).

> **Status: phase 0 (foundations).** The product spec, architecture and roadmap are in
> [`docs/PLAN.md`](docs/PLAN.md).

## Requirements

- Node.js ≥ 22.12 and pnpm 10 (`corepack enable`)
- Docker with Compose v2
- OpenSSL (used by the installer)

## Quick start

```bash
./install.sh          # creates .env + storage credentials with strong random secrets
pnpm install
pnpm infra:up         # PostgreSQL (PostGIS + pgvector), Redis, SeaweedFS (S3)
pnpm dev              # API on http://localhost:4000
curl localhost:4000/health   # {"status":"ok"}
curl localhost:4000/ready    # {"status":"ready","checks":{"postgres":"up","redis":"up"}}
```

Optional service profiles:

```bash
docker compose -f infra/docker-compose.yml --env-file .env --profile full up -d  # + ClamAV
docker compose -f infra/docker-compose.yml --env-file .env --profile ai up -d    # + Ollama
docker compose -f infra/docker-compose.yml --env-file .env --profile dev up -d   # + Mailpit
docker compose -f infra/docker-compose.yml --env-file .env --profile app up -d   # + API container
```

Regenerating secrets: `./install.sh --force` refuses to run over existing data, because Postgres
and Redis keep their original passwords. `./install.sh --force --reset-data` **deletes all local
data** and starts fresh.

## Scripts

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Run all apps in watch mode              |
| `pnpm build`         | Build all packages                      |
| `pnpm check`         | Format check, lint, typecheck and tests |
| `pnpm test`          | Unit and integration tests (Vitest)     |
| `pnpm infra:up/down` | Start or stop local infrastructure      |

## Repository layout

```
apps/api           Fastify API (TypeScript): security headers, rate limiting, health/readiness
packages/shared    Zod schemas, error codes and types shared by server and clients
infra/             Docker Compose, Postgres image (PostGIS + pgvector), storage config
docs/              Product spec, architecture, threat model, legal drafts
```

Coming next: `apps/mobile` (Expo: iOS, Android, web/PWA), `apps/worker`, `apps/admin`,
`packages/db`, `packages/ai`.

## Security defaults

- Strict security headers (CSP `default-src 'none'`, no framing, no referrer, HSTS in production)
- CORS allowlist only (wildcard rejected in production)
- Global rate limiting backed by Redis; request body limit 64 KB by default
- Uniform error envelope `{ "error": { "code", "message", "requestId" } }` with no stack traces
- Logs redact authorization headers, cookies, tokens, emails and phone numbers
- All infrastructure ports bind to `127.0.0.1`; the API container runs as a non-root user
- CI: lint, typecheck, tests, dependency audit, CodeQL, Gitleaks, Dependabot

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Running an instance

Whoever deploys an instance is the operator, and legal controller, of its users' data. Before
going public you will need, at minimum, a privacy policy, terms of use, an accessibility
statement and a moderation process. Drafts will ship with the project, but they **require review
by a qualified lawyer** for your jurisdiction.

## License

[MIT](LICENSE)
