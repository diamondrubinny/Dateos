import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { he } from '../src/i18n/he';

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

describe('translations', () => {
  const english = flatten(en as Tree);
  const hebrew = flatten(he as Tree);

  it('have the same keys in every language', () => {
    expect(Object.keys(hebrew).sort()).toEqual(Object.keys(english).sort());
  });

  it('have no empty strings', () => {
    for (const [key, value] of [...Object.entries(english), ...Object.entries(hebrew)]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('use the same {{placeholders}} in every language', () => {
    for (const [key, value] of Object.entries(english)) {
      expect(placeholders(hebrew[key]!), key).toEqual(placeholders(value));
    }
  });
});
