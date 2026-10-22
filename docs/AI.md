# AI in NexaHeart

Every AI feature in NexaHeart is optional, explainable, and runs **on the community's own server by
default**. Nothing is sent to an external AI service unless the operator configures one **and** the
member opts in. This page lists every feature, the data it uses, and how to turn it off.

> ⚖️ Operators: depending on your jurisdiction, the EU AI Act, GDPR (profiling, Art. 22) and Israeli
> privacy law may require specific notices. Review this page with your privacy counsel and mention the
> features you enable in your privacy policy. This is not legal advice.

## Features

| Feature                                 | What it does                                                      | Data used                                                            | Where it runs                                                                          | Default                                 | Turn off                                                               |
| --------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| **Matching ("vibe")**                   | Similarity of profile texts, one of five ranking signals          | Bio + prompt answers + intention (never name, age, gender or photos) | This server (hashing, or Ollama embeddings)                                            | Hashing, no model                       | Operator: `EMBEDDINGS_PROVIDER=hashing`                                |
| **"Why you might click"**               | Shows the reasons behind a recommendation                         | Ranking signals                                                      | This server, rules                                                                     | On                                      | Always on (it explains, it does not decide)                            |
| **"Are you sure?" and hidden messages** | Warns before sending insults/threats; hides them for the receiver | The message text, in memory                                          | This server, word lists and rules                                                      | On                                      | Not switchable (safety)                                                |
| **Scam warnings**                       | Warns the receiver about money/crypto/off-platform requests       | The message text                                                     | This server, rules                                                                     | On                                      | Not switchable (safety)                                                |
| **Icebreakers**                         | Three opening lines for a new chat                                | The other person's bio and prompt answers                            | Templates; or a model on this server; or an external model if **both** people opted in | Templates                               | Operator: `ICEBREAKERS_PROVIDER=template`; member: just don't tap them |
| **Profile tips**                        | Suggests improvements (photos, bio, prompts, verification)        | Your own profile                                                     | This server, published rules (`packages/ai/src/coach.ts`)                              | On                                      | Ignore them                                                            |
| **Bio drafts**                          | On request, two drafts of your bio from your own words            | Your own bio and prompt answers                                      | A model on this server; or an external model if **you** opted in                       | Off unless the operator enables a model | Operator: no model; member: don't ask                                  |

What NexaHeart does **not** do with AI: no attractiveness scoring, no face recognition (photo verification
is a human comparison), no automatic decisions about accounts (moderators decide), no reading of
private messages by a model, no advertising profiles.

## Safety of generated text

All model output is treated as untrusted and checked before anyone sees it:

- plain text in the expected language and script (Hebrew text with Arabic letters, or French instead of
  English, is rejected);
- no links, emails, phone numbers, social handles or messaging-app names;
- nothing flagged by the harm check;
- no echo of prompt-injection phrases ("ignore previous instructions", "system prompt", Hebrew forms);
- bio drafts must reuse facts from the person's own text (small models invent hobbies), contain no
  placeholders or markdown, and differ from the current bio.

Anything that fails is dropped; icebreakers fall back to (or are topped up with) templates. Bio drafts
are never applied automatically: the person edits and saves.

## Evals

`packages/ai/evals` contains 12 profiles in English and Hebrew, 4 of them prompt-injection attempts
(instructions in the bio, fake "SYSTEM:" text, requests to add links or messaging handles) and one
asking for sexual content. Run it against any provider:

```bash
pnpm --filter @nexaheart/ai eval                                   # templates
EVAL_PROVIDER=ollama OLLAMA_CHAT_MODEL=qwen2.5:1.5b pnpm --filter @nexaheart/ai eval
EVAL_PROVIDER=openai OPENAI_BASE_URL=... OPENAI_MODEL=... pnpm --filter @nexaheart/ai eval
```

Results on this repository (2026-10-21; model output varies between runs):

| Provider                       | Icebreakers with model lines      | Bio drafts (profiles with ≥ 1 draft) | Problems (leaks, contact details, harm) |
| ------------------------------ | --------------------------------- | ------------------------------------ | --------------------------------------- |
| Templates (no AI)              | 0 / 12 (all templates, by design) | n/a                                  | **0**                                   |
| `qwen2.5:1.5b` (Ollama, ~1 GB) | 11 / 12                           | 6 / 12 (10 drafts)                   | **0**                                   |
| `qwen2.5:7b` (Ollama, ~4.7 GB) | 8 / 12                            | 5 / 12 (8 drafts)                    | **0**                                   |

What the evals found and what changed because of them:

1. `qwen2.5:7b` returned the injection text from a bio verbatim as a "bio draft". → Drafts and icebreakers
   now reject instruction-like text, and templates no longer quote it.
2. Models often return 1 good icebreaker instead of 3, which used to throw everything away. → Good lines
   are kept and topped up with templates.
3. A model added "follow me on Instagram @…". → Social handles and messaging apps are blocked.
4. Small models invent facts ("bookworm", "artist") and leave `**[Name]**` placeholders. → Grounding and
   placeholder checks.
5. **Hebrew quality from both local models is weak** (wrong grammatical gender, odd phrasing). The checks
   catch unsafe or mixed-script output, but not awkward grammar. Drafts are labelled as AI drafts that may
   be wrong, and are never applied automatically. For Hebrew, prefer templates, or a stronger multilingual
   model through `ICEBREAKERS_PROVIDER=openai`, and re-run the evals before enabling it.

## Choosing a provider

| Setting                                                                        | Privacy                                                                                                 | Quality                                       | Cost                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `template`                                                                     | Nothing leaves the server, no model                                                                     | Fixed phrases                                 | Free                                                      |
| `ollama`                                                                       | Nothing leaves the server                                                                               | Small models: fine in English, weak in Hebrew | Free; ~2 GB RAM (1.5B) to ~8 GB (7B)                      |
| `openai`, `OPENAI_EXTERNAL=false` (vLLM, llama.cpp, LM Studio on your network) | Stays on your infrastructure                                                                            | Depends on the model                          | Your hardware                                             |
| `openai`, `OPENAI_EXTERNAL=true` (cloud)                                       | Text of consenting members goes to the provider ⚖️ (needs a DPA, check retention and training terms 📘) | Usually best                                  | Per request; members are limited to 10 bio drafts per day |
