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
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: async (_: string, data: string) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)),
}));

const { checkLock, clearLock, hasLock, isValidLockCode, setLock } =
  await import('../src/lib/app-lock');

describe('app lock (device only)', () => {
  beforeEach(() => store.clear());

  it('4 to 8 digits only', () => {
    for (const ok of ['1234', '00000000', '482913']) expect(isValidLockCode(ok)).toBe(true);
    for (const bad of ['123', '123456789', '12a4', ' 1234', '']) {
      expect(isValidLockCode(bad)).toBe(false);
    }
  });

  it('keeps a salted hash, never the code; the right code opens, others don’t', async () => {
    expect(await hasLock()).toBe(false);
    await setLock('482913');
    expect(await hasLock()).toBe(true);
    const saved = [...store.values()].join();
    expect(saved).not.toContain('482913');
    expect(await checkLock('482913')).toBe(true);
    expect(await checkLock('482914')).toBe(false);
    expect(await checkLock('abc')).toBe(false);
    // A new code gets a new salt.
    const first = store.get('nexaheart.app-lock');
    await setLock('482913');
    expect(store.get('nexaheart.app-lock')).not.toBe(first);
    await clearLock();
    expect(await hasLock()).toBe(false);
    expect(await checkLock('482913')).toBe(false);
  });
});
