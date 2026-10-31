# Phase 75b: Ask about this profile (v1.62)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 75, part 2: questions and answers based
> **only on what the other person made public**. The onboarding interview is 75c; the AI in a
> shared chat later.

## What's here today (checked in the code)

- Text AI (phase 5) is optional: a model on the community's own server, or an external one that
  needs each person's `ai_cloud` consent, all of them when someone else's text is sent
  (icebreakers, `AiGate`).
- A profile shows the viewer only what its owner made visible to them (phase 2 and later).

## Decisions

- **Only what the viewer already sees, and less:** bio, prompt answers, interests, children,
  smoking, drinking, height, languages, intention, opening question and friends' takes. Never
  religion or faith, gender identity, accessibility needs, the Match Note, relationship history,
  photos, the name or the distance, even when they're visible. Sensitive categories aren't worth
  a model's guess ⚖️.
- **Both consents for an external model.** The profile's owner is the one whose text goes out, so
  an external model needs their `ai_cloud` consent as well as the asker's. If only the owner hasn't
  consented, the feature just isn't offered for that profile (it doesn't say why, so their choice
  stays private).
- **Grounded or silent.** The model answers only from the data; otherwise "The profile doesn't
  say". Answers are short, have links and numbers stripped, and are never stored.
- **Not a replacement for talking:** the screen says it's a summary of what they wrote, and to ask
  them for anything else.

## What changes

| Part         | Change                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On a profile | "Ask about this profile": a question box ("Do they like hiking?"); the answer, or "The profile doesn't say". Where an external model needs the asker's consent, a link to turn it on. |
| Limits       | 20 questions a day per person; a question is one line, at most 200 characters.                                                                                                        |

## Tests

- Integration (with a fake model that records what it was sent): only the listed fields are sent,
  never the sensitive ones; the answer and "doesn't say"; links stripped; external model: the
  asker's consent, then the owner's (hidden as unavailable); no model: unavailable; only profiles
  the asker may see; the daily limit; nothing stored.
- e2e (en, he): ask on a profile and see the answer (a fake local model in the e2e API). axe 0.
  Screenshot.

## Done

- **Integration** (`ask-profile.test.ts`, a fake model that records what it was sent): the bio,
  interests and prompt answers go to the model; religion, accessibility needs, relationship
  history, the name, the account id and the location never do, though visible; the answer, or
  null when the profile doesn't say; links, e-mail addresses and phone numbers stripped; nothing
  stored; questions validated (length, one line, no markup); one's own profile and someone who
  blocked the asker give 404 and nothing reaches the model; an external model: the asker's
  consent first, then the owner's, whose missing consent shows only as "unavailable"; 20 a day.
- **e2e** `pnpm --dir e2e ask-profile` (en, he), with `e2e/fake-model.mjs` standing in for a local
  model: a question the profile answers, and one it doesn't. axe 0. Screenshot `193-ask-profile`.
- Docs: AI.md, PRIVACY.md, CHANGELOG, README.

### Not done here

- The onboarding interview (75c), and the AI matchmaker in a shared chat.
