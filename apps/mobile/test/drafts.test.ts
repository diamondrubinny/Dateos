// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../src/lib/storage', () => ({
  prefs: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    remove: async (k: string) => void store.delete(k),
  },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('react', () => ({ useCallback: (f: unknown) => f }));

const { clearDrafts, loadDrafts, MAX_DRAFT_LENGTH, saveDraft } = await import('../src/lib/drafts');
const A = '7f1c2a9e-0000-4000-8000-000000000001';
const B = '7f1c2a9e-0000-4000-8000-000000000002';

describe('message drafts (device only)', () => {
  beforeEach(() => store.clear());

  it('saves per chat, and an empty box clears the draft', async () => {
    await saveDraft(A, 'Hey, about Saturday');
    await saveDraft(B, 'Hi!');
    expect(await loadDrafts()).toEqual({ [A]: 'Hey, about Saturday', [B]: 'Hi!' });
    await saveDraft(A, '   ');
    expect(await loadDrafts()).toEqual({ [B]: 'Hi!' });
    expect([...store.keys()].sort()).toEqual([`nexaheart.draft.${B}`, 'nexaheart.drafts']);
  });

  it('drops drafts older than 30 days', async () => {
    const day = 86_400_000;
    await saveDraft(A, 'old', Date.now() - 31 * day);
    await saveDraft(B, 'new');
    expect(await loadDrafts()).toEqual({ [B]: 'new' });
    expect(store.has(`nexaheart.draft.${A}`)).toBe(false);
  });

  it('sign-out removes every draft and the index', async () => {
    await saveDraft(A, 'one');
    await saveDraft(B, 'two');
    await clearDrafts();
    expect(store.size).toBe(0);
  });

  it('caps the length and ignores ids that are not safe storage keys', async () => {
    await saveDraft(A, 'x'.repeat(MAX_DRAFT_LENGTH + 50));
    await saveDraft('../../etc', 'nope');
    const drafts = await loadDrafts();
    expect(drafts[A]).toHaveLength(MAX_DRAFT_LENGTH);
    expect(Object.keys(drafts)).toEqual([A]);
  });
});
