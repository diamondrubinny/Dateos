import { describe, expect, it } from 'vitest';
import { checkHarm, containsContactOrLink, detectScamSignals } from '../src/moderation.js';
import {
  matchesLocaleScript,
  sanitizeSuggestions,
  templateIcebreakers,
} from '../src/icebreakers.js';

describe('Arabic and Russian', () => {
  it('flags insults, sexual requests and threats', () => {
    expect(checkHarm('انت غبي جدا').categories).toEqual(['insult']);
    expect(checkHarm('والغبية').flagged).toBe(true); // prefix + article
    expect(checkHarm('غَبِيّ').flagged).toBe(true); // short vowels
    expect(checkHarm('ارسلي صور عارية').categories).toContain('sexual');
    expect(checkHarm('سأقتلك').categories).toEqual(['threat']); // alef with hamza
    expect(checkHarm('Ты идиот').categories).toEqual(['insult']);
    expect(checkHarm('Пришли нюдсы').categories).toContain('sexual');
    expect(checkHarm('Я знаю, где ты живёшь').categories).toEqual(['threat']); // ё → е
    expect(checkHarm('и д и о т').flagged).toBe(true); // spaced letters
  });

  it('does not flag ordinary messages', () => {
    for (const text of [
      'عندي كلب صغير اسمه ريكس', // "dog" is not an insult on its own
      'هل تحب القهوة في الصباح؟',
      'Я люблю гулять с собакой',
      'Давай встретимся в кафе в субботу',
      'Это было глупо с моей стороны, извини', // not in the list on purpose
    ]) {
      expect(checkHarm(text).flagged, text).toBe(false);
    }
  });

  it('detects scam signals', () => {
    expect(detectScamSignals('ممكن ترسل لي المال؟ ارسل لي المال الان', 0)).toContain('money');
    expect(detectScamSignals('Переведи деньги, пожалуйста', 0)).toContain('money');
    expect(detectScamSignals('Инвестиционная платформа и биткоин', 0)).toContain('crypto');
    expect(detectScamSignals('اكلمك على واتساب', 0)).toContain('off_platform');
  });

  it('checks the script of model output', () => {
    expect(matchesLocaleScript('مرحبًا! كيف كان يومك؟', 'ar')).toBe(true);
    expect(matchesLocaleScript('Привет! Как прошёл день?', 'ru')).toBe(true);
    expect(matchesLocaleScript('Hello! How was your day?', 'ru')).toBe(false);
    expect(matchesLocaleScript('مرحبا Привет', 'ar')).toBe(false); // mixed scripts
    expect(matchesLocaleScript('Привет, Noa! Как прошли выходные?', 'ru')).toBe(true); // a Latin name is fine
    expect(containsContactOrLink('Напиши мне в телеграм')).toBe(true);
    expect(containsContactOrLink('كلمني على واتساب')).toBe(true);
    expect(sanitizeSuggestions(['«Привет! Что нового?»'], 'ru')).toEqual(['Привет! Что нового?']);
  });

  it('has templates for every prompt in both languages', async () => {
    for (const locale of ['ar', 'ru'] as const) {
      const lines = await templateIcebreakers.suggest({
        locale,
        otherName: 'Noa',
        bio: null,
        prompts: [{ promptKey: 'perfect_sunday', answer: 'Jaffa flea market' }],
      });
      expect(lines).toHaveLength(3);
      for (const l of lines.slice(1)) expect(matchesLocaleScript(l, locale), l).toBe(true);
    }
  });
});

describe('linear-time text cleanup (no regex backtracking)', () => {
  it('trims quote marks around a line', async () => {
    const { trimQuotes } = await import('../src/icebreakers.js');
    expect(trimQuotes('“Hello there”')).toBe('Hello there');
    expect(trimQuotes('«Привет»')).toBe('Привет');
    expect(trimQuotes('״שלום״')).toBe('שלום');
    expect(trimQuotes('He said "hi" today')).toBe('He said "hi" today');
    expect(trimQuotes('""""')).toBe('');
  });

  it('stays fast on adversarial input', async () => {
    const { trimQuotes } = await import('../src/icebreakers.js');
    const quotes = '"'.repeat(100_000) + 'x' + '"'.repeat(100_000) + 'x';
    const emailish = 'a@'.repeat(50_000) + ' ' + '.'.repeat(50_000);
    const start = performance.now();
    trimQuotes(quotes);
    containsContactOrLink(emailish);
    sanitizeSuggestions([quotes], 'en');
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('still finds email addresses', () => {
    expect(containsContactOrLink('write to noa.levi@example.co.il')).toBe(true);
    expect(containsContactOrLink('me@x.io')).toBe(true);
    expect(containsContactOrLink('meet @ 8 at the café.')).toBe(false);
  });
});
