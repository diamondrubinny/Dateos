import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getRandomBytes } from 'expo-crypto';
import { base64url } from './pkce';

/**
 * End-to-end encryption for calls (phase 16b). Each device makes a fresh X25519 key pair per call;
 * only the public halves travel (through the call's signalling). Both devices derive the same media
 * key from their own secret and the other public key; the server never sees it.
 */
export interface CallKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

const INFO = new TextEncoder().encode('nexaheart call e2ee v1');

export function newCallKeyPair(): CallKeyPair {
  const secretKey = getRandomBytes(32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** Public keys in a fixed order, so both sides compute the same values. */
function ordered(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [first, second] = toBase64Url(a) < toBase64Url(b) ? [a, b] : [b, a];
  const out = new Uint8Array(64);
  out.set(first, 0);
  out.set(second, 32);
  return out;
}

/**
 * The 32-byte media key: HKDF-SHA256 over the X25519 shared secret, bound to this room and to both
 * public keys (a key from another call or another pair of keys never matches).
 */
export function deriveCallKey(
  mine: CallKeyPair,
  theirPublicKey: Uint8Array,
  room: string,
): Uint8Array {
  const shared = x25519.getSharedSecret(mine.secretKey, theirPublicKey);
  const salt = sha256(new TextEncoder().encode(room));
  const info = new Uint8Array(INFO.length + 64);
  info.set(INFO, 0);
  info.set(ordered(mine.publicKey, theirPublicKey), INFO.length);
  return hkdf(sha256, shared, salt, info, 32);
}

/** 64 easy-to-say emoji: 4 of them (24 bits) make the safety code. */
// prettier-ignore
const EMOJI = [
  '🍎', '🍌', '🍇', '🍉', '🍒', '🍋', '🥝', '🍍',
  '🥕', '🌽', '🍄', '🌵', '🌻', '🌹', '🍀', '🌲',
  '🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐨',
  '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧',
  '🐦', '🦉', '🐝', '🦋', '🐢', '🐙', '🐬', '🐳',
  '⚽', '🏀', '🎾', '🎲', '🎸', '🎺', '🥁', '🎨',
  '🚗', '🚲', '🚀', '⛵', '🏠', '⏰', '🔑', '💡',
  '📚', '✏️', '🎈', '🎁', '☂️', '⭐', '🌙', '☀️',
] as const;

/**
 * A short code both people see if, and only if, nobody swapped a public key on the way: compare it
 * out loud to be sure the call is private.
 */
export function safetyCode(a: Uint8Array, b: Uint8Array): string[] {
  const digest = sha256(ordered(a, b));
  const bits = (digest[0]! << 16) | (digest[1]! << 8) | digest[2]!;
  return [18, 12, 6, 0].map((shift) => EMOJI[(bits >> shift) & 63]!);
}

/** base64url without padding (shared with the sign-in code; no btoa, which older Hermes lacks). */
export const toBase64Url = base64url;

const DECODE = new Map(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'].map((c, i) => [c, i]),
);

/** A 32-byte key from its 43-character base64url form, or null for anything else. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const out = new Uint8Array(32);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    value = (value << 6) | DECODE.get(char)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (index < 32) out[index] = (value >> bits) & 0xff;
      index += 1;
    }
  }
  // The last character carries 2 spare bits, which must be zero in a canonical encoding.
  return index === 32 && (value & ((1 << bits) - 1)) === 0 ? out : null;
}
