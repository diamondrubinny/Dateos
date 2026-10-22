// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { EMBEDDING_DIM, type Intention, type PromptAnswer } from '@nexaheart/shared';

export interface EmbeddingProvider {
  /** Stored with each vector so scores are only compared within the same model. */
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Text that describes someone's interests. Never includes name, age, gender or photos. */
export function profileText(input: {
  bio: string | null;
  intention: Intention;
  prompts: PromptAnswer[];
}): string {
  return [input.bio ?? '', ...input.prompts.map((p) => p.answer)].join('\n').trim();
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have i i'm im in is it its me my of on or our so that the this to was we with you your " +
    'את של על עם אני זה זו הוא היא הם הן גם אבל או כי אם לא כן יש אין מה מי כל רק עוד מאוד כמו אל ב ל ה ו ש מ'
  ).split(' '),
);

/** Lowercases, strips Hebrew vowel marks and punctuation, splits into word tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '') // Hebrew niqqud and cantillation
    .replace(/[̀-ͯ]/g, '') // Latin diacritics
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Offline lexical embeddings via the hashing trick: word unigrams, bigrams and character
 * trigrams (robust to Hebrew prefixes such as ה/ו/ב/ל) hashed into a fixed-size, L2-normalised
 * vector. No model download, no external calls: the default for small instances.
 */
export function hashingEmbedding(text: string, dim = EMBEDDING_DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  const features: [string, number][] = [];
  tokens.forEach((token, i) => {
    features.push([`w:${token}`, 1]);
    if (i > 0) features.push([`b:${tokens[i - 1]} ${token}`, 0.7]);
    const padded = `^${token}$`;
    for (let j = 0; j + 3 <= padded.length; j += 1)
      features.push([`c:${padded.slice(j, j + 3)}`, 0.35]);
  });
  const counts = new Map<string, number>();
  for (const [feature, weight] of features)
    counts.set(feature, (counts.get(feature) ?? 0) + weight);
  for (const [feature, weight] of counts) {
    const hash = fnv1a(feature);
    const sign = hash & 0x80000000 ? -1 : 1;
    vector[hash % dim]! += sign * (1 + Math.log(weight + 1)); // sub-linear term frequency
  }
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

export const hashingProvider: EmbeddingProvider = {
  model: 'hashing-v1',
  embed: async (texts) => texts.map((text) => hashingEmbedding(text)),
};

/**
 * Local semantic embeddings through Ollama's /api/embed endpoint 📘. The model must output
 * EMBEDDING_DIM dimensions (e.g. `paraphrase-multilingual`, which also handles Hebrew).
 */
export function ollamaProvider(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): EmbeddingProvider {
  return {
    model: `ollama:${model}`,
    async embed(texts) {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`Ollama embed failed with HTTP ${res.status}`);
      const body = (await res.json()) as { embeddings?: number[][] };
      const embeddings = body.embeddings ?? [];
      if (
        embeddings.length !== texts.length ||
        embeddings.some((e) => e.length !== EMBEDDING_DIM)
      ) {
        throw new Error(
          `Ollama model ${model} must return ${EMBEDDING_DIM}-dimensional embeddings`,
        );
      }
      return embeddings.map((e) => {
        const norm = Math.hypot(...e);
        return norm === 0 ? e : e.map((v) => v / norm);
      });
    },
  };
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
