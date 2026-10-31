// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import * as Crypto from 'expo-crypto';
import { prefs } from './storage';

/**
 * Phase 67a, app lock: a 4–8 digit code asked when the app opens and after a while away. Kept on
 * this device only, as a salted SHA-256 hash; it isn't a password the server knows, and it can't
 * protect a phone that's already compromised.
 */
const KEY = 'nexaheart.app-lock';
/** Locked again after this long in the background. */
export const LOCK_AFTER_MS = 5 * 60_000;
/** After this many wrong codes in a row, wait before the next try. */
export const MAX_TRIES = 5;
export const WAIT_MS = 30_000;

export const isValidLockCode = (code: string) => /^\d{4,8}$/.test(code);

type Stored = { v: 1; salt: string; hash: string };

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function digest(salt: string, code: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${code}`, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

async function read(): Promise<Stored | null> {
  try {
    const value: unknown = JSON.parse((await prefs.get(KEY)) ?? 'null');
    return value && typeof value === 'object' && (value as Stored).v === 1
      ? (value as Stored)
      : null;
  } catch {
    return null;
  }
}

export async function hasLock(): Promise<boolean> {
  return (await read()) !== null;
}

export async function setLock(code: string): Promise<void> {
  if (!isValidLockCode(code)) throw new Error('4 to 8 digits');
  const salt = toHex(Crypto.getRandomBytes(16));
  await prefs.set(KEY, JSON.stringify({ v: 1, salt, hash: await digest(salt, code) }));
}

export async function clearLock(): Promise<void> {
  await prefs.remove(KEY);
}

export async function checkLock(code: string): Promise<boolean> {
  const stored = await read();
  if (!stored || !isValidLockCode(code)) return false;
  const hash = await digest(stored.salt, code);
  // Same length hex strings; compare every character so the time doesn't hint at the code.
  let diff = hash.length ^ stored.hash.length;
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}
