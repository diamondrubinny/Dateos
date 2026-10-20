import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { authClient } from './auth-client';

/** Where the emailed link returns to: the web origin, or the app's deep link on device. */
export function callbackUrl(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.origin}/`
    : Linking.createURL('/');
}

export async function requestMagicLink(email: string): Promise<boolean> {
  const { error } = await authClient.signIn.magicLink({ email, callbackURL: callbackUrl() });
  return !error;
}
