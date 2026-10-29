# Phase 41: Change your email address (v1.14)

> Status: ✅ done (2026-10-29). 📘 = verify against official docs, ⚖️ = needs legal review.

Sign-in is by email link only, so the address is the account. Until now there was no way to change
it: someone who lost an old mailbox lost the account.

## The flow

1. **Settings → Security → Email address**: shows the current address, and "Change email".
2. The member enters the new address. The API always answers the same ("If it can be used, a link
   is on its way"), so the form can't be used to find out whether an address has an account.
3. A **confirmation link** goes to the **new** address (valid **30 minutes**, one use), only when
   the address can be used. A short **heads-up always goes to the current address**, without a link ("If this wasn't you, sign in and secure
   your account"), the same no-link rule as the new-device alert (phase 32).
4. The member opens the link **while signed in to the same account** (another account's session,
   or none, can't confirm it). The address is checked again (free, not banned, phase 21), then:
   - the account's email changes;
   - **every other device is signed out** (this one stays);
   - the change appears in Account activity (phase 31) and the audit log, without the addresses.
5. A newer request replaces an older one. At most **3 requests an hour** per member.

## Security

- The link carries a random 32-byte token; only its SHA-256 hash is stored, with the account, the
  new address and the expiry. Used, expired or replaced tokens stop working at once.
- No account enumeration: taken, banned and free addresses get the same answer; the outcome is
  only learnt by whoever controls the new mailbox (and then only "can't be used").
- Data: `email_changes` (migration `0048_email_changes.sql`), deleted on use, when expired (swept
  with each new request) and with the account. ⚖️ PRIVACY.md row.
- Addresses inside Hebrew and Arabic sentences are wrapped in Unicode isolates (LRI…PDI), so they
  read left to right in one piece and the punctuation stays put.

## Order of work

1. db, shared, API (request, confirm), mail templates; integration tests.
2. App: Email address in Settings → Security, the confirm screen; i18n ×4. e2e
   `pnpm --dir e2e change-email` (real mail through Mailpit).
3. Docs, PR, CI, merge.
