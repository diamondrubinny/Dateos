// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it, vi } from 'vitest';

// expo-crypto is a native module; in tests the bytes come from the runtime's Web Crypto.
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
}));

const { deriveCallKey, fromBase64Url, newCallKeyPair, safetyCode, toBase64Url } =
  await import('../src/lib/call-crypto');

describe('call encryption keys', () => {
  it('both devices derive the same key, bound to the room', () => {
    const a = newCallKeyPair();
    const b = newCallKeyPair();
    const keyA = deriveCallKey(a, b.publicKey, 'room-1');
    const keyB = deriveCallKey(b, a.publicKey, 'room-1');
    expect(keyA).toHaveLength(32);
    expect(toBase64Url(keyA)).toBe(toBase64Url(keyB));
    expect(toBase64Url(deriveCallKey(a, b.publicKey, 'room-2'))).not.toBe(toBase64Url(keyA));
  });

  it('a swapped key (someone in the middle) gives different keys and a different safety code', () => {
    const a = newCallKeyPair();
    const b = newCallKeyPair();
    const mallory = newCallKeyPair();
    // Mallory gives each side her own key instead of the other's.
    const keyA = deriveCallKey(a, mallory.publicKey, 'r');
    const keyB = deriveCallKey(b, mallory.publicKey, 'r');
    expect(toBase64Url(keyA)).not.toBe(toBase64Url(keyB));
    const codeA = safetyCode(a.publicKey, mallory.publicKey);
    const codeB = safetyCode(b.publicKey, mallory.publicKey);
    expect(codeA).not.toEqual(codeB);
    // Without her, both see the same 4 emoji, whatever the order.
    expect(safetyCode(a.publicKey, b.publicKey)).toEqual(safetyCode(b.publicKey, a.publicKey));
    expect(safetyCode(a.publicKey, b.publicKey)).toHaveLength(4);
  });

  it('round-trips public keys and refuses anything that is not exactly one', () => {
    for (let i = 0; i < 50; i += 1) {
      const { publicKey } = newCallKeyPair();
      const text = toBase64Url(publicKey);
      expect(text).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fromBase64Url(text)).toEqual(publicKey);
    }
    expect(fromBase64Url('')).toBeNull();
    expect(fromBase64Url('A'.repeat(42))).toBeNull();
    expect(fromBase64Url('A'.repeat(44))).toBeNull();
    expect(fromBase64Url('+'.repeat(43))).toBeNull();
    // Non-canonical: the spare low bits of the last character are set.
    expect(fromBase64Url(`${'A'.repeat(42)}B`)).toBeNull();
    expect(fromBase64Url(`${'A'.repeat(42)}E`)).toEqual(
      new Uint8Array([...new Array(31).fill(0), 0x01]),
    );
  });
});
