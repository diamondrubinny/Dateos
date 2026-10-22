// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  bioIdeas,
  coachTips,
  openAiCompatibleModel,
  sanitizeBioIdeas,
  type TextModel,
} from '../src/index.js';

const prompts = (n: number, answer = 'Sunrise swims at Gordon beach') =>
  Array.from({ length: n }, (_, i) => ({
    promptKey: (['green_flag', 'first_date_idea', 'perfect_sunday'] as const)[i % 3]!,
    answer,
  }));

describe('coachTips', () => {
  it('suggests the most useful fixes first and nothing for a complete profile', () => {
    expect(
      coachTips({ photoCount: 1, bio: null, prompts: [], verified: false }).map((t) => t.id),
    ).toEqual(['add_photos', 'bio_missing', 'add_prompts', 'verify']);
    expect(
      coachTips({
        photoCount: 4,
        bio: 'Architect who bakes sourdough and runs at sunrise by the sea.',
        prompts: prompts(3),
        verified: true,
      }),
    ).toEqual([]);
  });

  it('spots short, generic and empty-ish answers in both languages', () => {
    const ids = (bio: string, p = prompts(3)) =>
      coachTips({ photoCount: 3, bio, prompts: p, verified: true }).map((t) => t.id);
    expect(ids('Hi')).toEqual(['bio_short']);
    expect(ids('I love to travel and I am looking for my other half, just ask!')).toEqual([
      'bio_generic',
    ]);
    expect(ids('אני אוהבת לטייל ומחפשת את החצי השני שלי, תשאלו')).toEqual(['bio_generic']);
    expect(
      ids('Teacher, climber, terrible at karaoke but enthusiastic about it.', prompts(3, 'Yes')),
    ).toEqual(['prompt_short']);
  });
});

describe('bio ideas', () => {
  const model = (output: string | null, external = false): TextModel => ({
    name: 'fake',
    external,
    complete: async () => output,
  });

  it('returns up to two validated ideas and drops unsafe or wrong-language ones', async () => {
    const output = [
      '1. I teach kids to code by day and take sunrise swims at Gordon beach. Looking for someone to share Friday markets with.',
      '2. Message me on Instagram @me for more! I love dogs, sunsets and long walks on the beach together.',
      '3. Je suis une personne très gentille et j’aime beaucoup la musique et les voyages lointains.',
      '4. Sunrise swimmer at Gordon beach and a very loyal friend. Tell me your favourite market stall and I will meet you there.',
    ].join('\n\n');
    const ideas = await bioIdeas(model(output), { locale: 'en', bio: 'Hi', prompts: prompts(1) });
    expect(ideas).toHaveLength(2);
    expect(ideas[0]).toMatch(/^I teach kids/);
    expect(ideas.join(' ')).not.toContain('Instagram');
    expect(ideas.join(' ')).not.toContain('Je suis');
  });

  it('never returns the current bio, harmful text, or anything when the model fails', async () => {
    const bio =
      'I teach kids to code by day and bake sourdough by night, looking for a kind partner.';
    expect(sanitizeBioIdeas(bio, 'en', bio)).toEqual([]);
    expect(
      sanitizeBioIdeas(
        'Send nudes and I will tell you more about my hobbies and my job, honestly.',
        'en',
        null,
      ),
    ).toEqual([]);
    expect(await bioIdeas(model(null), { locale: 'en', bio, prompts: [] })).toEqual([]);
    const failing: TextModel = {
      name: 'x',
      external: false,
      complete: async () => {
        throw new Error('down');
      },
    };
    expect(await bioIdeas(failing, { locale: 'en', bio, prompts: [] })).toEqual([]);
  });

  it('accepts Hebrew ideas in Hebrew only', () => {
    const he = 'מורה למדעים שאוהבת לאפות לחם מחמצת ולשחות בזריחה. מחפשת מישהו לשוק של יום שישי.';
    expect(sanitizeBioIdeas(he, 'he', null, he)).toEqual([he]);
    expect(sanitizeBioIdeas(he, 'en', null, he)).toEqual([]);
  });
});

describe('grounding and placeholders', () => {
  it('drops ideas that invent facts or contain template placeholders', async () => {
    const { isGrounded } = await import('../src/coach.js');
    const source =
      'Sunrise swimmer and sourdough baker. Perfect Sunday: Gordon beach and pastries.';
    expect(
      isGrounded('I swim at sunrise and bake sourdough, then pastries on the beach.', source),
    ).toBe(true); // sunrise, sourdough, pastries, beach come from the profile
    expect(
      isGrounded('Sunrise swimmer who bakes sourdough for friends every weekend.', source),
    ).toBe(true);
    expect(
      isGrounded('Bookworm and painter who loves museums and quiet cafés downtown.', source),
    ).toBe(false);
    expect(
      sanitizeBioIdeas(
        'My name is **[Name]** and I am a sunrise swimmer and sourdough lover for sure.',
        'en',
        null,
        source,
      ),
    ).toEqual([]);
  });

  it('rejects drafts with the generic phrases the coach flags', () => {
    const source = 'אוהבת לטייל ולשחות בזריחה בחוף גורדון, ואז מאפים וספר טוב.';
    expect(
      sanitizeBioIdeas(
        'אני אוהבת לטייל ולשחות בזריחה בחוף גורדון, ואחר כך מאפים וספר טוב בשקט.',
        'he',
        null,
        source,
      ),
    ).toEqual([]);
  });

  it('works with Hebrew prefixes', async () => {
    const { isGrounded } = await import('../src/coach.js');
    expect(
      isGrounded(
        'אופה לחם מחמצת שרצה בבוקר ליד הים, ואוהבת את שוק הכרמל.',
        'אופה לחם מחמצת ושוק הכרמל',
      ),
    ).toBe(true);
  });
});

describe('looksEnglish', () => {
  it('tells English from other Latin-script languages', async () => {
    const { looksEnglish } = await import('../src/coach.js');
    expect(looksEnglish('I teach kids to code and bake bread for my friends on the weekend.')).toBe(
      true,
    );
    expect(looksEnglish('Je suis une personne très gentille et j’aime beaucoup la musique.')).toBe(
      false,
    );
    expect(looksEnglish('Soy una persona tranquila, me gusta la playa y el café con leche.')).toBe(
      false,
    );
  });
});

describe('OpenAI-compatible client', () => {
  it('sends the system/user messages and the key, and reads the first choice', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const m = openAiCompatibleModel({
      baseUrl: 'http://llm.local/v1/',
      model: 'm',
      apiKey: 'k',
      external: true,
      fetchImpl: fakeFetch,
    });
    expect(await m.complete({ system: 'S', user: 'U' })).toBe('hello');
    expect(calls[0]!.url).toBe('http://llm.local/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ]);
    expect(m.external).toBe(true);
  });

  it('returns null on HTTP errors', async () => {
    const fakeFetch = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const m = openAiCompatibleModel({
      baseUrl: 'http://x',
      model: 'm',
      external: false,
      fetchImpl: fakeFetch,
    });
    expect(await m.complete({ system: 's', user: 'u' })).toBeNull();
  });
});
