import { moderationActions, reportCategories, verificationPoses } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { format, messages } from '../src/i18n';

type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, path) };
  }, {});

describe('dashboard translations', () => {
  const en = flatten(messages.en as unknown as Tree);
  const he = flatten(messages.he as unknown as Tree);

  it('have the same keys and placeholders in both languages', () => {
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [key, value] of Object.entries(en)) expect(vars(he[key]!), key).toEqual(vars(value));
  });

  it('cover every category, action and pose the API can return', () => {
    for (const locale of ['en', 'he'] as const) {
      const t = messages[locale];
      for (const c of reportCategories) expect(t.categories[c]).toBeTruthy();
      for (const a of moderationActions) expect(t.actions[a]).toBeTruthy();
      for (const p of verificationPoses) expect(t.poses[p]).toBeTruthy();
    }
  });

  it('formats placeholders', () => {
    expect(format('Photo {{n}} of {{name}}', { n: 2, name: 'Noa' })).toBe('Photo 2 of Noa');
  });
});
