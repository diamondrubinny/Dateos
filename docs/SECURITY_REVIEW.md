# Security review (phase 7)

> 🔍 An internal review, not a substitute for an independent penetration test before a public launch.

## Dependency advisories (`pnpm audit --prod`, 2026-10-21)

| Advisory                                                                 | Package (path)                                      | Severity | Reachable at runtime?                                                                                        | Decision                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge (`expo` → `@expo/cli`)                   | high     | No: the Expo CLI uses it for local development certificates; it is not part of the app bundle, API or worker | Ignored in `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`); no patched version exists. Re-check monthly |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | braces (`expo` → Metro → micromatch)                | high     | No: build-time file globbing with patterns from the project itself                                           | Ignored, same reason                                                                                      |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | esbuild ≤ 0.24 (`better-auth` → `drizzle-kit` peer) | moderate | No: only affects `esbuild --serve` dev servers, never started                                                | Below the CI threshold (high); tracked                                                                    |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | uuid < 11.1.1 (Expo config plugins → xcode)         | moderate | No: native project generation, and only when a buffer is passed                                              | Below the CI threshold; tracked                                                                           |

CI still fails on any **new** high or critical advisory.
