// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { base64url, toBase64url } from '../src/lib/pkce';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('pkce encoding', () => {
  it('RFC 4648 test vectors (unpadded)', () => {
    expect(base64url(bytes(''))).toBe('');
    expect(base64url(bytes('f'))).toBe('Zg');
    expect(base64url(bytes('fo'))).toBe('Zm8');
    expect(base64url(bytes('foo'))).toBe('Zm9v');
    expect(base64url(bytes('foob'))).toBe('Zm9vYg');
    expect(base64url(bytes('fooba'))).toBe('Zm9vYmE');
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8'); // url-safe characters
  });

  it('RFC 7636 appendix B: verifier and S256 challenge', () => {
    const octets = [
      116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77,
      105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
    ];
    expect(base64url(new Uint8Array(octets))).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    // SHA-256 of that verifier, as standard base64 (what expo-crypto returns):
    expect(toBase64url('E9Melhoa2OvFrAYcYAKrB+ueYbnwMQ5SZTNC9n9wRMw=')).toBe(
      'E9Melhoa2OvFrAYcYAKrB-ueYbnwMQ5SZTNC9n9wRMw',
    );
  });
});
