# Phase 5: AI features (local first, transparent, optional)

> Status: ✅ done (2026-10-21). 📘 = verify against official docs, ⚖️ = needs legal review.

Already in place: embeddings for "vibe" matching (phase 2), reciprocal ranking with reasons (phase 2),
icebreakers with injection-safe output checks (phase 3), local harm and scam detection (phase 3).

## Scope

| #   | Deliverable                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Profile Coach** (always available, no AI needed): deterministic, explainable tips (few photos, short or generic bio, few prompts, not verified) with a button that takes you to the fix                                                                                                            |
| 2   | **Bio ideas** (optional, AI): on request only, 2 rewrites of your own bio from your own prompts. Never applied automatically; you edit and save. Output checked (length, language script, no links/contact details, not identical)                                                                   |
| 3   | **Provider switch** for text AI: `template` (no AI) · `ollama` (local) · `openai` (any OpenAI-compatible endpoint: vLLM, llama.cpp, LM Studio, or a cloud service). An **external** endpoint is used only for members who opted in to `ai_cloud`; everyone else gets the local/template behaviour ⚖️ |
| 4   | **Better harm detection**: masked and spaced-out words (`f*ck`, `i d i o t`, `i.d.i.o.t`, `ז ו נ ה`)                                                                                                                                                                                                 |
| 5   | **Evals**: a dataset of English/Hebrew profiles, including prompt-injection attempts, run against each provider; pass rate and injection leaks are reported. Results for the default local model are published                                                                                       |
| 6   | **`docs/AI.md`**: every AI feature, what data it uses, where it runs, how to turn it off (transparency, EU AI Act ⚖️)                                                                                                                                                                                |

## API

| Endpoint                                 | Notes                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /v1/me/coach`                       | tips + whether bio ideas are available for this member                           |
| `POST /v1/me/coach/bio-ideas` `{locale}` | rate limited (10/day); 409 when no AI provider or no consent for an external one |

## Threat model additions

| Threat                                                   | Control                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Prompt injection through your own bio/prompts            | Text passed as quoted data; output validated; never auto-applied; the person sees and edits every word            |
| Sending personal data to a third party                   | External endpoints only with `ai_cloud` consent; name, age, gender and photos are never sent; documented in AI.md |
| Model output that is harmful or contains contact details | Same validators as icebreakers plus the harm check; failures fall back to "no suggestion"                         |
| Cost/abuse of a paid endpoint                            | Per-member daily limit                                                                                            |

## Tests

Unit: coach rules, masked-word detection (true and false positives), OpenAI-compatible client against a fake server, consent gating.
Integration: coach endpoint, bio ideas with a fake provider (validated, rate limited, consent required for external).
Evals: template, Ollama `qwen2.5:1.5b` (local), recorded in AI.md.
E2E: coach screen + bio ideas screenshots, axe.

## Also fixed: profile editing after onboarding

While building the coach, it turned out members **could not edit their profile after onboarding**
(there was no way back to photos, prompts or bio). The coach would have sent people to fix things they
could not change. Now: "Edit bio" (with optional AI drafts), and the photos and prompts screens open in
an edit mode from the profile tab and from the coach.

## Results

| Check                                   | Result                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                              | ai 45: masked/spaced harm words (and no guessing when ambiguous), coach rules EN/HE, bio-draft validation (language, grounding, placeholders, contact details, generic phrases, injection echo), OpenAI-compatible client, partial icebreakers                                |
| Integration tests                       | **84 passed** (5 new): tips without AI, drafts from the member's own text only (payload has just `bio` and `prompts`), external model only with consent, icebreakers only when both people consented, consent withdrawal immediate, 10 per day, unsafe output returns nothing |
| Mutation tests                          | Accepting one person's consent for icebreakers, or skipping the consent check, makes the suite fail                                                                                                                                                                           |
| Evals                                   | Templates, `qwen2.5:1.5b` and `qwen2.5:7b`: 0 problems after the fixes listed in `docs/AI.md`                                                                                                                                                                                 |
| E2E (en + he) with the real local model | Coach tips → bio drafts from Ollama → use a draft → tips update                                                                                                                                                                                                               |
| axe-core WCAG 2.1 A/AA (6 new screens)  | **0** after fixing one issue (two buttons named "Edit bio" on one screen)                                                                                                                                                                                                     |

## Known limitations

- Hebrew drafts from small local models are often awkward; grammatical gender is not sent to the model
  (gender is never shared with AI), so drafts may use the wrong form. People edit before saving.
- The language check for English drafts is a heuristic (common function words).
- Bios themselves are not checked for contact details or harm when saved (only generated drafts are).
