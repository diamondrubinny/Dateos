# Security Policy

NexaHeart handles highly sensitive personal data (location, photos, private messages, sexual
orientation). We take every report seriously.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:
**Security → Report a vulnerability** on this repository (private vulnerability reporting).

Please include:

- affected component and version/commit
- reproduction steps or proof of concept
- impact (what data or action an attacker gains)

We aim to acknowledge reports within 72 hours and to agree on a disclosure timeline with you.
Please give us reasonable time to ship a fix before any public disclosure.

## Scope

In scope: code in this repository (API, workers, mobile/web apps, installer, infrastructure
templates). Out of scope: third-party instances run by other operators. Report those to the operator.

## Supported versions

Until v1.0, only the latest `main` receives security fixes.

## For instance operators

Each self-hosted instance is operated, and legally controlled, by whoever deploys it. Keep it on
the latest release, never expose Postgres, Redis or object storage ports publicly, and keep `.env`
and `infra/data/` private.
