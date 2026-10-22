// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

/**
 * iOS and Android: captions from the phone's own speech recognition, **on the device only**
 * (`requiresOnDeviceRecognition`): the audio is never sent to Apple or Google (phase 16c). 📘
 */
const ANDROID_ON_DEVICE = 'com.google.android.as';

export type SpeechAvailability = 'available' | 'downloadable' | 'unavailable';

export async function onDeviceSpeechAvailable(lang: string): Promise<SpeechAvailability> {
  try {
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return 'unavailable';
    const { installedLocales, locales } = await ExpoSpeechRecognitionModule.getSupportedLocales(
      Platform.OS === 'android' ? { androidRecognitionServicePackage: ANDROID_ON_DEVICE } : {},
    );
    const known = installedLocales.length > 0 ? installedLocales : locales;
    const base = lang.split('-')[0]!.toLowerCase();
    return known.some((l) => l.toLowerCase().replace('_', '-').split('-')[0] === base)
      ? 'available'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Phones manage their own language packs (system settings); nothing to install from the app. */
export async function installOnDeviceSpeech(_lang: string): Promise<boolean> {
  return false;
}

export function startSpeech(
  lang: string,
  onText: (text: string, final: boolean) => void,
  onError: () => void,
): () => void {
  let stopped = false;
  const subscriptions = [
    ExpoSpeechRecognitionModule.addListener('result', (event) => {
      const text = event.results[0]?.transcript;
      if (text) onText(text, event.isFinal);
    }),
    ExpoSpeechRecognitionModule.addListener('error', () => {
      stopped = true;
      onError();
    }),
    // Recognition can end after silence; start again until stopped.
    ExpoSpeechRecognitionModule.addListener('end', () => {
      if (!stopped) start();
    }),
  ];
  const start = () =>
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      ...(Platform.OS === 'android' ? { androidRecognitionServicePackage: ANDROID_ON_DEVICE } : {}),
    });
  void ExpoSpeechRecognitionModule.requestPermissionsAsync().then((permission) => {
    if (!permission.granted) {
      stopped = true;
      onError();
      return;
    }
    if (!stopped) start();
  });
  return () => {
    stopped = true;
    ExpoSpeechRecognitionModule.abort();
    subscriptions.forEach((s) => s.remove());
  };
}
