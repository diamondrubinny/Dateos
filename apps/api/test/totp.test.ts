import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  timeStep,
  totp,
  verifyTotp,
} from '../src/lib/totp.js';

const rfcSecret = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP (RFC 6238 appendix B, SHA-1)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('time %i → %s', (seconds, expected) => {
    expect(hotp(rfcSecret, timeStep(seconds * 1000), 8)).toBe(expected);
  });

  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(rfcSecret)).equals(rfcSecret)).toBe(true);
    expect(base32Encode(rfcSecret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('accepts ±1 step and rejects replays and wrong codes', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const code = totp(secret, now);
    const step = timeStep(now);
    expect(verifyTotp(secret, code, now, 0)).toBe(step);
    expect(verifyTotp(secret, code, now + 30_000, 0)).toBe(step);
    expect(verifyTotp(secret, code, now + 90_000, 0)).toBeNull();
    expect(verifyTotp(secret, code, now, step)).toBeNull(); // replay
    expect(verifyTotp(secret, '12345', now, 0)).toBeNull();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    expect(verifyTotp(secret, wrong, now, 0)).toBeNull();
  });

  it('builds an otpauth URL authenticator apps understand', () => {
    const url = new URL(otpauthUrl('NexaHeart', 'mod@example.test', 'ABC'));
    expect(url.protocol).toBe('otpauth:');
    expect(url.searchParams.get('secret')).toBe('ABC');
    expect(url.searchParams.get('issuer')).toBe('NexaHeart');
  });
});

describe('secret encryption', () => {
  const key = deriveKey('x'.repeat(40), 'staff-mfa');

  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret(key, 'JBSWY3DPEHPK3PXP');
    const b = encryptSecret(key, 'JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(decryptSecret(key, a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects tampering and the wrong key', () => {
    const payload = encryptSecret(key, 'secret');
    const [iv, tag, data] = payload.split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret(key, `${iv}.${tag}.${flipped.toString('base64url')}`)).toThrow();
    expect(() => decryptSecret(deriveKey('y'.repeat(40), 'staff-mfa'), payload)).toThrow();
  });
});
