import { EMBEDDING_DIM } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { cosine, hashingEmbedding, ollamaProvider, profileText, tokenize } from '../src/index.js';

describe('tokenize', () => {
  it('drops stopwords, punctuation and Hebrew vowel marks', () => {
    expect(tokenize('I love the SEA, and hiking!')).toEqual(['love', 'sea', 'hiking']);
    expect(tokenize('שָׁלוֹם עם הים')).toEqual(['שלום', 'הים']);
  });
});

describe('hashingEmbedding', () => {
  it('is deterministic, normalised and of the stored dimension', () => {
    const a = hashingEmbedding('hiking by the sea');
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(a).toEqual(hashingEmbedding('hiking by the sea'));
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
  });

  it('ranks related texts closer than unrelated ones (English and Hebrew)', () => {
    const hikerA = hashingEmbedding(
      'weekend hiking trips in the mountains and camping under the stars',
    );
    const hikerB = hashingEmbedding('I love camping and hiking in the mountains');
    const gamer = hashingEmbedding('video games, board games and coding late at night');
    expect(cosine(hikerA, hikerB)).toBeGreaterThan(cosine(hikerA, gamer) + 0.1);

    const heA = hashingEmbedding('אוהבת טיולים בטבע וקמפינג בהרים');
    const heB = hashingEmbedding('טיול בהרים וקמפינג בסופ"ש');
    const heC = hashingEmbedding('משחקי מחשב ותכנות בלילות');
    expect(cosine(heA, heB)).toBeGreaterThan(cosine(heA, heC));
  });

  it('returns a zero vector for empty text instead of NaN', () => {
    expect(hashingEmbedding('').every((v) => v === 0)).toBe(true);
  });
});

describe('profileText', () => {
  it('uses only the bio and prompt answers', () => {
    expect(
      profileText({
        bio: 'Baker',
        intention: 'long_term',
        prompts: [{ promptKey: 'green_flag', answer: 'Kindness' }],
      }),
    ).toBe('Baker\nKindness');
  });
});

describe('ollamaProvider', () => {
  const fakeFetch = (embeddings: number[][], status = 200) =>
    (async () => new Response(JSON.stringify({ embeddings }), { status })) as typeof fetch;

  it('normalises vectors and tags the model', async () => {
    const provider = ollamaProvider(
      'http://ollama:11434',
      'paraphrase-multilingual',
      fakeFetch([new Array(EMBEDDING_DIM).fill(2)]),
    );
    const [vector] = await provider.embed(['x']);
    expect(provider.model).toBe('ollama:paraphrase-multilingual');
    expect(Math.hypot(...vector!)).toBeCloseTo(1, 6);
  });

  it('rejects models with the wrong dimension and HTTP errors', async () => {
    await expect(
      ollamaProvider('http://o', 'm', fakeFetch([[1, 2, 3]])).embed(['x']),
    ).rejects.toThrow('768-dimensional');
    await expect(ollamaProvider('http://o', 'm', fakeFetch([], 500)).embed(['x'])).rejects.toThrow(
      'HTTP 500',
    );
  });
});
