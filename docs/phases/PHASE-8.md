# Phase 8: Arabic and Russian, and the marketing page

> Status: ✅ done (2026-10-21). 📘 = verify against official docs, ⚖️ = needs legal review.

Goal: the app fully usable in **Hebrew, English, Arabic and Russian** (Arabic right-to-left), real
screenshots in all four, and a marketing description of the project in all four languages in the repo.

## Scope

| #   | Deliverable                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/shared`: one list of supported locales (`he`, `en`, `ar`, `ru`) and the right-to-left set (`he`, `ar`), used by every schema instead of hard-coded `['he', 'en']` |
| 2   | App: full Arabic and Russian translations (every key, same placeholders, gender-inclusive wording like the Hebrew), Arabic RTL, language switch with four options           |
| 3   | Server texts in the four languages: icebreaker templates, push notification text, AI language checks (Arabic and Cyrillic script), AI prompts                               |
| 4   | Harm detection: a small, conservative Arabic and Russian word list (insults, threats, scam phrases), documented as limited ⚖️                                               |
| 5   | Admin: default language choice for the instance includes Arabic and Russian (dashboard itself stays Hebrew/English)                                                         |
| 6   | Screenshots in all four languages (onboarding, discovery, chat, safety, privacy) and showcase strips                                                                        |
| 7   | `docs/marketing/` in English, Russian, Arabic and Hebrew: what Dateos is, who it is for, advantages, screenshots, how to start; linked from the README                      |

## Non-goals

Translating the legal drafts into Arabic and Russian (they need a lawyer per country anyway ⚖️) and the
moderation dashboard.

## Tests

Translation test for all four languages (same keys, same placeholders, nothing empty, no English left
in place of a translation); icebreaker templates and script checks for each language; harm detection
true/false positives in Arabic and Russian; e2e screenshots with axe in all four languages.

## Results

| Check             | Result                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Translations      | Arabic and Russian: every key, same placeholders, every text in the right script (test). Reviewed terms: «приостановлен» for suspended (not «заблокирован», which means blocked), "عطلة نهاية الأسبوع" for the "perfect Sunday" prompt (Sunday is a work day in many Arab countries) |
| Unit tests        | ai 53 (Arabic/Russian harm, scam, script checks, templates, linear-time cleanup), mobile 18 (four languages), worker 14, shared 22, api 38, admin 3                                                                                                                                  |
| Integration tests | **109** (icebreakers in Arabic and Russian, unknown locale rejected)                                                                                                                                                                                                                 |
| E2E               | Screenshots, chat, privacy and accessibility in **all four languages**; the chat test proves on the live UI that an Arabic/Russian insult is hidden and a scam message is flagged. axe-core: **0** violations; `lang`/`dir` correct (Arabic right-to-left)                           |
| CodeQL            | 3 high alerts (regex backtracking) found on the PR, fixed, 0 in a local run of the same suite                                                                                                                                                                                        |
| Marketing         | `docs/marketing/{en,he,ar,ru}.md` with screenshots of each language; README language bar                                                                                                                                                                                             |

## Bugs found and fixed

1. A push notification with a locale like `toString` would have crashed (`in` sees inherited
   properties); now `Object.hasOwn`.
2. Three regular expressions could take quadratic time on crafted input (CodeQL), see above.
3. The coach e2e used an ambiguous selector on the no-draft path.
4. Leftover e2e accounts appeared in marketing screenshots; removed from the dev database before
   capturing.

## Known limitations

- The Arabic and Russian harm lists are deliberately small (to avoid false positives) and do not cover
  dialects or transliteration (Arabizi, "translit"); human moderation remains the safety net ⚖️.
- Bio drafts and AI icebreakers in Arabic and Russian depend on the local model's quality; the
  offline templates are always available.
- Legal drafts and the moderation dashboard stay in English and Hebrew.
