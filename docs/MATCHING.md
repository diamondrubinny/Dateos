# How NexaHeart matching works

NexaHeart publishes its matching algorithm so anyone can check it: users, researchers, and every community that runs an instance.
The code lives in [`packages/ai/src/scoring.ts`](../packages/ai/src/scoring.ts) and
[`apps/api/src/modules/discovery/visibility.ts`](../apps/api/src/modules/discovery/visibility.ts).

## Goals

1. **Mutual fit.** Show people who are likely to be interested _in each other_, not just people you might like.
2. **Fairness.** Don't concentrate attention on a few profiles, and give newcomers a fair start.
3. **Explainability.** Every recommendation comes with plain reasons ("You want the same thing", "Close by").
4. **No exploitation.** No "desirability" or Elo score, no attractiveness ranking, no paid boosts. Everything is free.

## Step 1: who can see whom (hard rules)

Two people can only see each other when **both** of the following hold, in both directions:

| Rule             | Detail                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Gender           | Each person's gender is in the other's "interested in" list                                                                             |
| Age              | Each person's age is inside the other's age range                                                                                       |
| Distance         | They are within the _smaller_ of the two maximum distances                                                                              |
| Intention filter | If someone chose intentions to filter by, the other person's intention must be one of them                                              |
| Dealbreakers     | Smoking, children, height and (with its consent) religious observance, if someone chose them. A missing answer always passes (phase 19) |
| Safety           | Both accounts are active; nobody blocked anybody; they never unmatched                                                                  |
| Completeness     | The person has a location and at least one photo that passed scanning                                                                   |

The same rule decides who can open a profile, view a photo, or send a like. Anything outside it returns "not found".

## Step 2: ranking (soft signals)

For each visible person the server computes:

| Signal    | Weight | How                                                                                                                                                                                                                   |
| --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vibe      | 30%    | Similarity of profile texts (bio + prompt answers) as embeddings. Default: offline hashing embeddings; optionally a local semantic model through Ollama. Name, age, gender and photos are **never** part of the text. |
| Intention | 25%    | Compatibility of what both are looking for (e.g. long-term ↔ long-term = 1.0, long-term ↔ casual = 0.2)                                                                                                               |
| Activity  | 20%    | Recently active people are more likely to answer                                                                                                                                                                      |
| Distance  | 15%    | Closer is better, never below 0.2 inside the range                                                                                                                                                                    |
| Language  | 10%    | Sharing a language                                                                                                                                                                                                    |

`compatibility = Σ weight × signal` (0–1), then **× (1 + 0.05 × shared interests)**, at most 3 counted (phase 19): a nudge, never a filter. Shared interests also show as a reason ("Shared interests").

**Reciprocity:** `0.4 + 0.6 × P(they like you back)`. P is the person's recent like rate, Laplace-smoothed, or 0.95 if they already liked you.
The floor of 0.4 means choosy people are never hidden.
That someone liked you is used for ranking only. Their like appears in your **Likes** tab, which is free for everyone; it is never shown as a "reason" on a card.

**Fairness:** `exposure = 1 / (1 + times shown in the last 24 h / 20)` dampens profiles that everyone is already seeing,
and members in their first week get a ×1.1 boost.

`score = compatibility × reciprocity × fairness`, scaled to 0–1000. Ties are broken by a stable daily key, so lists don't reshuffle on reload.

## Step 3: surfaces

- **Daily Picks:** the top 10 for you, chosen once a day and stable for that day. People you decide on drop out.
- **Discover:** the next best people, excluding today's picks and anyone you already decided on.
- **Likes You:** everyone who liked you, free. Liking back creates a match.
- **Your turn (focus mode):** when 6 or more people are waiting for your reply (chats whose last message is theirs), a new like is refused with `YOUR_TURN` and Discover asks you to answer them first. Passing still works, and nothing about ranking changes. It's a burnout guard, not a penalty.

## What we deliberately do not use

Attractiveness or photo analysis for ranking · "desirability"/Elo · ethnicity, religion, health, or any protected trait
(these can only ever be filters a person chooses) · paid boosts · data from other apps.

## Privacy of the inputs

| Input               | Protection                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location            | Snapped to a ~1 km grid before storage. Exact coordinates are never stored, logged or returned. Distances are shown as buckets ("less than 5 km"), which defeats trilateration below cell size. |
| Profile text        | Turned into an embedding on the instance's own server. Nothing is sent to external AI services unless an operator configures one _and_ the user opts in.                                        |
| Impressions & picks | Kept 30 days for fairness counters, then deleted                                                                                                                                                |

## Tuning for your community

The weights are constants in `scoring.ts`. Instances can change them, but **any change must keep the rules above**: mutual
visibility, no protected-trait ranking, and free access to likes. If you change them, please publish your changes too.

### Switching the embedding model

Vibe is only compared between embeddings from the same model, so mixing models is safe but makes the signal neutral.
After changing `EMBEDDINGS_PROVIDER` or `OLLAMA_EMBED_MODEL`, re-embed everyone:

```bash
pnpm --filter @nexaheart/worker reembed
```

Measured on this repository (English vs. Hebrew sentences with the same meaning): `paraphrase-multilingual` similarity **0.93**
(unrelated sentence 0.18); hashing embeddings −0.02, because they only see shared words.

> Limitations: hashing embeddings capture shared words and word fragments, not meaning; for semantic matching, run Ollama with a
> 768-dimension multilingual model (`EMBEDDINGS_PROVIDER=ollama`). Scores are a ranking aid, not a prediction of compatibility.
