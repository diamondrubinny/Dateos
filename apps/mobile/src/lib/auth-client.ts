import { expoClient } from '@better-auth/expo/client';
import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_URL, APP_SCHEME } from './config';

const isWeb = Platform.OS === 'web';

/**
 * Web uses the API's HttpOnly session cookie directly. Native apps keep the session in the
 * OS keychain/keystore via SecureStore and send it as a Cookie header.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/v1/auth',
  fetchOptions: isWeb ? { credentials: 'include' } : {},
  plugins: [
    magicLinkClient(),
    ...(isWeb
      ? []
      : [
          expoClient({
            scheme: APP_SCHEME,
            storagePrefix: 'nexaheart',
            cookiePrefix: 'nexaheart',
            storage: SecureStore,
          }),
        ]),
  ],
});

export async function authHeaders(): Promise<Record<string, string>> {
  if (isWeb) return {};
  const getCookie = (authClient as unknown as { getCookie?: () => Promise<string> | string })
    .getCookie;
  const cookie = getCookie ? await getCookie() : '';
  return cookie ? { cookie } : {};
}
