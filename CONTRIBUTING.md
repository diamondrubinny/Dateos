# Contributing to NexaHeart

Thanks for helping build a free, safe, privacy-first dating platform.

## Ground rules

- Security, privacy and accessibility are requirements, not extras. PRs that weaken them will not be merged.
- Never commit secrets, real personal data or real user photos. Seed and test data must be fictional.
- Every endpoint must enforce authorization on the server and must have tests covering access to
  another user's resources (IDOR/BOLA).
- UI must work in Hebrew (RTL) and English, with a screen reader, and without swipe gestures.

## License of contributions

NexaHeart is licensed under the [AGPL-3.0-or-later](LICENSE) with the additional terms in
[NOTICE](NOTICE). By opening a pull request you agree that your contribution is licensed the same
way. New source files start with the license header; `node scripts/check-credit.mjs --fix` adds it,
and `pnpm lint` fails without it. Never remove the "Powered by NexaHeart" credit.

## Development

```bash
./install.sh          # generates .env with random secrets
pnpm install
pnpm infra:up         # postgres + postgis + pgvector, redis, object storage
pnpm dev
```

Integration tests (`pnpm --filter @nexaheart/api test:integration`) run against isolated resources (database
`<name>_test`, Redis DB 15, `nexaheart-test-*` buckets), so they never touch your local data.

Before opening a PR, run the same checks as CI:

```bash
pnpm check            # format, lint, typecheck, test
```

## Code style

- TypeScript strict mode everywhere; validate inputs with Zod schemas from `@nexaheart/shared`.
- Modules follow `routes → service → repository`. Routes stay thin.
- Code, identifiers and comments in English; user-facing text goes through i18n.
- Keep PRs small and focused; describe the user-facing change and any security/privacy impact.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Never report vulnerabilities in public issues.
