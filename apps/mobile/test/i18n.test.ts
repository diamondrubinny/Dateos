import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { ar } from '../src/i18n/ar';
import { he } from '../src/i18n/he';
import { ru } from '../src/i18n/ru';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, path) };
  }, {});
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const languages = { he, ar, ru } as const;
const scripts = { he: /\p{Script=Hebrew}/u, ar: /\p{Script=Arabic}/u, ru: /\p{Script=Cyrillic}/u };

describe('translations', () => {
  const english = flatten(en as Tree);

  for (const [code, tree] of Object.entries(languages) as [keyof typeof languages, Tree][]) {
    const other = flatten(tree);

    it(`${code}: same keys as English`, () => {
      expect(Object.keys(other).sort()).toEqual(Object.keys(english).sort());
    });

    it(`${code}: no empty strings`, () => {
      for (const [key, value] of Object.entries(other)) expect(value.trim(), key).not.toBe('');
    });

    it(`${code}: same {{placeholders}}`, () => {
      for (const [key, value] of Object.entries(english)) {
        expect(placeholders(other[key]!), key).toEqual(placeholders(value));
      }
    });

    it(`${code}: every text is actually translated`, () => {
      // Language names are shown in their own language everywhere.
      const untranslated = Object.entries(other).filter(([key, value]) => {
        const words = value.replace(/\{\{\w+\}\}/g, '');
        // Language names stay in their own language; pure punctuation needs no translation.
        if (key.startsWith('language.') || !/\p{L}/u.test(words)) return false;
        return !scripts[code].test(words);
      });
      expect(untranslated.map(([key]) => key)).toEqual([]);
    });
  }

  it('English has no empty strings', () => {
    for (const [key, value] of Object.entries(english)) expect(value.trim(), key).not.toBe('');
  });
});
