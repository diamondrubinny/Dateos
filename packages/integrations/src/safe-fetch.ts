// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class OutboundError extends Error {}

/** Addresses that must not be reached from a URL an admin typed (SSRF). */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      lower === '::' ||
      lower === '::1' ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff') ||
      lower.startsWith('64:ff9b:')
    );
  }
  return true;
}

export interface OutboundOptions {
  /** Hosts on the server's own network (Ollama, a self-hosted Matomo) may be reached. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
}

const defaultResolve = async (host: string) =>
  (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** Checks a URL an admin typed before anything is sent to it. */
export async function checkUrl(raw: string, options: OutboundOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundError('Not a valid address.');
  }
  if (url.username || url.password)
    throw new OutboundError('Addresses with passwords aren’t allowed.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && options.allowPrivate)) {
    throw new OutboundError('Use an https:// address.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await (options.resolve ?? defaultResolve)(host).catch(() => []);
  if (addresses.length === 0) throw new OutboundError('That host can’t be found.');
  if (!options.allowPrivate && addresses.some(isPrivateAddress)) {
    throw new OutboundError('That address is on a private network.');
  }
  return url;
}

/**
 * fetch for addresses admins configure: the checks above, no redirects (a redirect could point
 * anywhere), and a short timeout. Responses are never shown to anyone, only their status.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit,
  options: OutboundOptions = {},
): Promise<Response> {
  const url = await checkUrl(raw, options);
  const res = await (options.fetch ?? fetch)(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (res.status >= 300 && res.status < 400) throw new OutboundError('The address redirected.');
  return res;
}
