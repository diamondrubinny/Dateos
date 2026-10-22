import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Native sign-in without putting the session in a URL.
 *
 * better-auth's Expo plugin redirects a verified magic link to `<scheme>://…?cookie=<session>`. On
 * Android any app can register the same scheme and receive that URL, so the session could be
 * stolen. Instead, the app sends a PKCE challenge (SHA-256 of a secret it keeps) in the callback
 * URL; the redirect carries only a one-time code, and the session is handed over to whoever
 * presents the matching secret within two minutes.
 */
export const NATIVE_CODE_TTL_SECONDS = 120;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const key = (code: string) =>
  `dateos:native-code:${createHash('sha256').update(code).digest('hex')}`;
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export interface NativeRedirect {
  location: string;
}

/**
 * Rewrites a redirect to the app's scheme. Returns null when the response is not one (it is then
 * forwarded unchanged). The session cookies are never forwarded to the browser for these.
 */
export async function nativeRedirect(
  redis: Redis,
  scheme: string,
  location: string | null,
  cookies: string[],
): Promise<NativeRedirect | null> {
  if (!location?.startsWith(`${scheme}:`)) return null;
  let challenge: string | null = null;
  let error: string | null = null;
  try {
    const url = new URL(location);
    challenge = url.searchParams.get('challenge');
    error = url.searchParams.get('error');
  } catch {
    // unparsable: treated as an error below
  }
  const failure = `${scheme}://auth/callback?error=${encodeURIComponent(error ?? 'sign_in_failed')}`;
  const session = cookies.filter((c) => /session_token=/.test(c));
  if (error || !challenge || !CHALLENGE.test(challenge) || session.length === 0) {
    return { location: failure };
  }
  const code = randomBytes(32).toString('base64url');
  await redis.set(key(code), JSON.stringify({ cookies, challenge }), 'EX', NATIVE_CODE_TTL_SECONDS);
  return { location: `${scheme}://auth/callback?code=${code}` };
}

/** One attempt per code: a wrong verifier burns it. Returns the Set-Cookie values, or null. */
export async function exchangeNativeCode(
  redis: Redis,
  code: string,
  verifier: string,
): Promise<string[] | null> {
  const raw = await redis.getdel(key(code));
  if (!raw) return null;
  const { cookies, challenge } = JSON.parse(raw) as { cookies: string[]; challenge: string };
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(challengeOf(verifier));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return cookies;
}
