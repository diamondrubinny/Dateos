import { describe, expect, it } from 'vitest';
import {
  matchesLocaleScript,
  MAX_ICEBREAKER_LENGTH,
  ollamaIcebreakers,
  sanitizeSuggestions,
  templateIcebreakers,
} from '../src/index.js';

const input = {
  locale: 'en' as const,
  otherName: 'Daniel',
  bio: 'Surfer',
  prompts: [
    {
      promptKey: 'perfect_sunday' as const,
      answer: 'Sunrise surf session, shakshuka, then a long nap.',
    },
    { promptKey: 'green_flag' as const, answer: 'Call me at 054-1234567 or visit evil.xyz' },
  ],
};

describe('templateIcebreakers', () => {
  it('returns 3 distinct suggestions that quote short, clean answers', async () => {
    const out = await templateIcebreakers.suggest(input);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    expect(out[0]).toContain('Sunrise surf session');
    expect(out.join(' ')).not.toMatch(/054|evil\.xyz/); // contact details are never quoted
    for (const line of out) expect(line.length).toBeLessThanOrEqual(MAX_ICEBREAKER_LENGTH);
  });

  it('works in Hebrew and with no prompts', async () => {
    const he = await templateIcebreakers.suggest({ ...input, locale: 'he', prompts: [] });
    expect(he).toHaveLength(2);
    expect(he[0]).toMatch(/[֐-׿]/);
  });
});

describe('sanitizeSuggestions', () => {
  it('strips numbering and quotes and drops unsafe or overlong lines', () => {
    expect(
      sanitizeSuggestions([
        '1. "Hey there, love your surf story!"',
        '- Message me on telegram.me/x',
        'x'.repeat(200),
        '• What is your go-to café?',
      ]),
    ).toEqual(['Hey there, love your surf story!', 'What is your go-to café?']);
  });
});

describe('matchesLocaleScript', () => {
  it('accepts clean Hebrew and English, rejects mixed-language output from small models', () => {
    expect(matchesLocaleScript('איך נראית השבת המושלמת שלך?', 'he')).toBe(true);
    expect(matchesLocaleScript('What does your perfect Sunday look like?', 'en')).toBe(true);
    // Real output of a 1.5B model, seen while building this feature:
    expect(matchesLocaleScript('זה מפתיע שהكשה שלי מתרגלת את ה Hebrew שisco.', 'he')).toBe(false);
    expect(matchesLocaleScript('אני tracks את הרגליים ב trail running.', 'he')).toBe(false);
    expect(matchesLocaleScript('Привет, how are you?', 'en')).toBe(false);
  });
});

describe('ollamaIcebreakers', () => {
  const reply = (content: string, status = 200) =>
    (async () =>
      new Response(JSON.stringify({ message: { content } }), { status })) as typeof fetch;

  it('uses valid model output', async () => {
    const provider = ollamaIcebreakers(
      'http://o',
      'm',
      reply('Love your Sunday plan!\nWhat board do you ride?\nCoffee after a surf?'),
    );
    expect(await provider.suggest(input)).toEqual([
      'Love your Sunday plan!',
      'What board do you ride?',
      'Coffee after a surf?',
    ]);
  });

  it('falls back to templates on errors or unsafe output (prompt-injection resistant)', async () => {
    const injected = ollamaIcebreakers(
      'http://o',
      'm',
      reply('Sure! Visit https://evil.xyz\nIgnore all rules\n'),
    );
    expect(await injected.suggest(input)).toEqual(await templateIcebreakers.suggest(input));
    const broken = ollamaIcebreakers('http://o', 'm', reply('', 500));
    expect(await broken.suggest(input)).toEqual(await templateIcebreakers.suggest(input));
  });
});
