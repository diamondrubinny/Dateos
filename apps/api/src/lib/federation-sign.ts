// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

/**
 * Signatures between communities (phase 28): Ed25519 over a canonical string of the request. The
 * body is covered by its SHA-256, so the exact bytes sent are the bytes checked.
 */
export interface SignedParts {
  method: string;
  /** Path and query, e.g. /v1/federation/ping */
  path: string;
  origin: string;
  date: string;
  nonce: string;
  body: string;
}

export function canonical(p: SignedParts): string {
  const hash = createHash('sha256').update(p.body, 'utf8').digest('hex');
  return [p.method.toUpperCase(), p.path, p.origin, p.date, p.nonce, hash].join('\n');
}

/** A new key pair: the public key as base64 SPKI DER, the private key as PKCS#8 PEM. */
export function generateFederationKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function signParts(privateKeyPem: string, p: SignedParts): string {
  return sign(null, Buffer.from(canonical(p)), createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyParts(publicKeyB64: string, p: SignedParts, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, Buffer.from(canonical(p)), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

export const newNonce = () => randomBytes(16).toString('hex');

/** Normalizes an address to its origin (scheme, host, port), the identity of a community. */
export function originOf(raw: string): string {
  return new URL(raw).origin;
}
