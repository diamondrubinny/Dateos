# Phase 8: Arabic and Russian, and the marketing page

> Status: in progress. 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: the app fully usable in **Hebrew, English, Arabic and Russian** (Arabic right-to-left), real
screenshots in all four, and a marketing description of the project in all four languages in the repo.

## Scope

| # | Deliverable |
| --- | --- |
| 1 | `packages/shared`: one list of supported locales (`he`, `en`, `ar`, `ru`) and the right-to-left set (`he`, `ar`), used by every schema instead of hard-coded `['he', 'en']` |
| 2 | App: full Arabic and Russian translations (every key, same placeholders, gender-inclusive wording like the Hebrew), Arabic RTL, language switch with four options |
| 3 | Server texts in the four languages: icebreaker templates, push notification text, AI language checks (Arabic and Cyrillic script), AI prompts |
| 4 | Harm detection: a small, conservative Arabic and Russian word list (insults, threats, scam phrases), documented as limited ⚖️ |
| 5 | Admin: default language choice for the instance includes Arabic and Russian (dashboard itself stays Hebrew/English) |
| 6 | Screenshots in all four languages (onboarding, discovery, chat, safety, privacy) and showcase strips |
| 7 | `docs/marketing/` in English, Russian, Arabic and Hebrew: what Dateos is, who it is for, advantages, screenshots, how to start; linked from the README |

## Non-goals

Translating the legal drafts into Arabic and Russian (they need a lawyer per country anyway ⚖️) and the
moderation dashboard.

## Tests

Translation test for all four languages (same keys, same placeholders, nothing empty, no English left
in place of a translation); icebreaker templates and script checks for each language; harm detection
true/false positives in Arabic and Russian; e2e screenshots with axe in all four languages.
