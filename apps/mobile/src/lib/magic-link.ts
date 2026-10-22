import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { authClient } from './auth-client';
import { base64url, toBase64url } from './pkce';
import { prefs } from './storage';

const VERIFIER_KEY = 'nexaheart.signInVerifier';

/**
 * Where the emailed link returns to. Web: the web origin (the session is an HttpOnly cookie).
 * Native: the app's deep link with a PKCE challenge. The server answers with a one-time code that
 * only this installation can exchange, so an app that hijacks the scheme gets nothing usable.
 */
async function callbackUrl(): Promise<string> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/`;
  const verifier = base64url(Crypto.getRandomBytes(32));
  await prefs.set(VERIFIER_KEY, verifier);
  const challenge = toBase64url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  return Linking.createURL('/auth/callback', { queryParams: { challenge } });
}

export async function requestMagicLink(email: string): Promise<boolean> {
  const { error } = await authClient.signIn.magicLink({ email, callbackURL: await callbackUrl() });
  return !error;
}

/**
 * Finishes a native sign-in. The response's Set-Cookie is stored by the Expo auth client plugin
 * (keychain), exactly like any other sign-in response.
 */
export async function completeNativeSignIn(code: string): Promise<boolean> {
  const verifier = await prefs.get(VERIFIER_KEY);
  if (!verifier) return false;
  const { error } = await authClient.$fetch('/native/exchange', {
    method: 'POST',
    body: { code, verifier },
  });
  await prefs.remove(VERIFIER_KEY); // one attempt per link, like the server
  return !error;
}
