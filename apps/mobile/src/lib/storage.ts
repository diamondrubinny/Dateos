import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Small preference storage: SecureStore on device, localStorage on web. Failures are non-fatal. */
export const prefs = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      // Preference is lost; the app falls back to defaults.
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      // Nothing stored.
    }
  },
};
