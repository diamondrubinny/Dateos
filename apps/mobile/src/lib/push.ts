import type { Locale } from '@nexaheart/shared';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch, json } from './api';
import { prefs } from './storage';

const TOKEN_KEY = 'nexaheart.pushToken';

export type PushSetupResult = 'enabled' | 'denied' | 'unsupported' | 'not-configured';

/**
 * Opt-in push notifications. The token goes to this community's server only; notifications never
 * contain names or message text. 📘 Expo push notifications setup (EAS project id required).
 */
export async function enablePush(locale: Locale): Promise<PushSetupResult> {
  if (Platform.OS === 'web') return 'unsupported';
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
    body: json({ token, platform: Platform.OS, locale }),
  });
  await prefs.set(TOKEN_KEY, token);
  return 'enabled';
}

/** Called when turning notifications off and before signing out. */
export async function disablePush(): Promise<void> {
  const token = await prefs.get(TOKEN_KEY);
  if (!token) return;
  await apiFetch('/v1/me/push-tokens', { method: 'DELETE', body: json({ token }) }).catch(
    () => undefined,
  );
  await prefs.remove(TOKEN_KEY);
}

export async function pushEnabledOnThisDevice(): Promise<boolean> {
  return Platform.OS !== 'web' && Boolean(await prefs.get(TOKEN_KEY));
}
