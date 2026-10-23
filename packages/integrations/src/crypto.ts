// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * INTEGRATIONS_KEY: 32 random bytes, as 64 hex characters or base64. Null when missing or malformed:
 * integrations can then only be read, never saved.
 */
export function parseIntegrationsKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

/**
 * AES-256-GCM with a fresh 12-byte nonce. The integration id and field name are authenticated
 * too, so a ciphertext can't be moved to another field.
 */
export function encryptSecret(key: Buffer, context: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

/** Null when the key is wrong or the value was changed. */
export function decryptSecret(key: Buffer, context: string, sealed: string): string | null {
  const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data || iv.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
