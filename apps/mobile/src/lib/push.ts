// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Locale } from '@nexaheart/shared';
import Constants from 'expo-constants';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch, json } from './api';
import { base64url } from './pkce';
import { prefs } from './storage';
import { disableWebPush, enableWebPush, webPushEnabled } from './web-push';

const TOKEN_KEY = 'nexaheart.pushToken';
const DEVICE_SECRET_KEY = 'nexaheart.deviceSecret';

/**
 * A random secret made once per installation, kept only in the device's secure storage (Keychain
 * or Keystore; never localStorage), phase 29. The server keeps only its hash and moves this
 * device's push token to another account only with the same secret. The web app uses Web Push
 * (phase 60, lib/web-push.ts).
 */
async function deviceSecret(): Promise<string> {
  const saved = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
  if (saved) return saved;
  const secret = base64url(getRandomBytes(32));
  await SecureStore.setItemAsync(DEVICE_SECRET_KEY, secret);
  return secret;
}

export type PushSetupResult =
  'enabled' | 'denied' | 'unsupported' | 'not-configured' | 'home-screen';

/**
 * Opt-in push notifications. The token goes to this community's server only; notifications never
 * contain names or message text. 📘 Expo push notifications setup (EAS project id required).
 */
export async function enablePush(locale: Locale): Promise<PushSetupResult> {
  // Phase 60: the web app has its own (Web Push).
  if (Platform.OS === 'web') return enableWebPush(locale);
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return 'not-configured';
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return 'denied';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await apiFetch('/v1/me/push-tokens', {
    method: 'POST',
    body: json({ token, platform: Platform.OS, locale, deviceSecret: await deviceSecret() }),
  });
  await prefs.set(TOKEN_KEY, token);
  return 'enabled';
}

/** Called when turning notifications off and before signing out. */
export async function disablePush(): Promise<void> {
  if (Platform.OS === 'web') return disableWebPush();
  const token = await prefs.get(TOKEN_KEY);
  if (!token) return;
  await apiFetch('/v1/me/push-tokens', { method: 'DELETE', body: json({ token }) }).catch(
    () => undefined,
  );
  await prefs.remove(TOKEN_KEY);
}

export async function pushEnabledOnThisDevice(): Promise<boolean> {
  if (Platform.OS === 'web') return webPushEnabled().catch(() => false);
  return Boolean(await prefs.get(TOKEN_KEY));
}
