import { describe, expect, it } from 'vitest';
import {
  checkHarm,
  containsContactOrLink,
  detectScamSignals,
  normalizeForModeration,
} from '../src/index.js';

describe('normalizeForModeration', () => {
  it('undoes leetspeak, repeats and Hebrew vowel marks', () => {
    expect(normalizeForModeration('FUUUCK y0u!!!')).toBe('fuck you');
    expect(normalizeForModeration('אִידְיוֹט')).toBe('אידיוט');
  });
});

describe('checkHarm', () => {
  it('flags plain insults', () => {
    expect(checkHarm('you are such an idiot').categories).toEqual(['insult']);
  });

  it('known limitation: masked words like "f*ck" are not caught (phase 4 adds human review)', () => {
    expect(checkHarm('f*ck you').flagged).toBe(false);
  });

  it('catches insults, sexual harassment and threats in English', () => {
    expect(checkHarm('send nudes').categories).toEqual(['sexual']);
    expect(checkHarm('I KNOW WHERE YOU LIVE').categories).toEqual(['threat']);
    expect(checkHarm('youre ugly lol').categories).toEqual(['insult']);
    expect(checkHarm('5lut').categories).toEqual(['insult']);
  });

  it('catches the same in Hebrew, including attached prefixes', () => {
    expect(checkHarm('את פשוט מטומטמת').categories).toEqual(['insult']);
    expect(checkHarm('והמטומטם הזה').categories).toEqual(['insult']);
    expect(checkHarm('תשלחי עירום').categories).toEqual(['sexual']);
    expect(checkHarm('אני יודע איפה את גרה').categories).toEqual(['threat']);
  });

  it('does not flag normal flirting or everyday words that contain a bad word', () => {
    for (const text of [
      'You have a great smile',
      'Want to grab coffee this weekend?',
      'I am such a loser at bowling haha',
      'Scunthorpe is a town in England', // contains a slur as a substring
      'the pipe is סתום again',
      'נשמע מדהים, בא לך לצאת לקפה?',
      'היא עשתה מחקר על אמנות עירונית',
    ]) {
      expect(checkHarm(text), text).toEqual({ flagged: false, categories: [] });
    }
  });
});

describe('detectScamSignals', () => {
  it('spots money, crypto and gift-card requests in both languages', () => {
    expect(detectScamSignals('Can you send me money for my flight?', 20)).toEqual(['money']);
    expect(detectScamSignals('I made 300% on a crypto investment platform', 20)).toEqual([
      'crypto',
    ]);
    expect(detectScamSignals('buy me an itunes card please', 20)).toEqual(['gift_card']);
    expect(detectScamSignals('תעבירי לי כסף בביט', 20)).toEqual(['money']);
    expect(detectScamSignals('יש לי רווח מובטח בביטקוין', 20)).toEqual(['crypto']);
  });

  it('flags moving to another app only early in the conversation', () => {
    expect(detectScamSignals('add me on whatsapp', 2)).toEqual(['off_platform']);
    expect(detectScamSignals('my number is 054-123-4567', 3)).toEqual(['off_platform']);
    expect(detectScamSignals('add me on whatsapp', 40)).toEqual([]);
  });

  it('flags links and leaves ordinary messages alone', () => {
    expect(detectScamSignals('check www.example.xyz', 50)).toEqual(['link']);
    expect(detectScamSignals('I paid for dinner last night, it was lovely', 5)).toEqual([]);
    expect(detectScamSignals('See you at 8', 1)).toEqual([]);
  });
});

describe('containsContactOrLink', () => {
  it('detects links, emails and phone numbers', () => {
    expect(containsContactOrLink('visit https://x.io')).toBe(true);
    expect(containsContactOrLink('mail me a@b.com')).toBe(true);
    expect(containsContactOrLink('call +972 54 123 4567')).toBe(true);
    expect(containsContactOrLink('What is your favourite trail?')).toBe(false);
  });
});
