// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Web: captions from the browser's speech recognition, **on the device only** (phase 16c). Many
 * browsers send audio to a cloud service for speech recognition, so we use only the standard
 * `SpeechRecognition` with `processLocally`, and only when the browser says the language is
 * available on the device; anything else counts as unavailable. Never `webkitSpeechRecognition`.
 * 📘 https://webaudio.github.io/web-speech-api/
 */
interface OnDeviceRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
type RecognitionClass = (new () => OnDeviceRecognition) & {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

/** 'downloadable': the browser can get the on-device language pack once (no audio is sent). */
export type SpeechAvailability = 'available' | 'downloadable' | 'unavailable';

const recognitionClass = () =>
  (globalThis as { SpeechRecognition?: RecognitionClass }).SpeechRecognition;

export async function onDeviceSpeechAvailable(lang: string): Promise<SpeechAvailability> {
  const Recognition = recognitionClass();
  if (!Recognition?.available) return 'unavailable';
  try {
    const state = await Recognition.available({ langs: [lang], processLocally: true });
    return state === 'available'
      ? 'available'
      : state === 'downloadable' || state === 'downloading'
        ? 'downloadable'
        : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Downloads the on-device language pack (the person tapped "Allow captions"). 📘 */
export async function installOnDeviceSpeech(lang: string): Promise<boolean> {
  const Recognition = recognitionClass();
  try {
    return (await Recognition?.install?.({ langs: [lang], processLocally: true })) === true;
  } catch {
    return false;
  }
}

/**
 * Transcribes this device's microphone until stopped. Recognition pauses by itself after silence,
 * so it restarts until `stop()` is called. Returns the stop function.
 */
export function startSpeech(
  lang: string,
  onText: (text: string, final: boolean) => void,
  onError: () => void,
): () => void {
  const Recognition = recognitionClass();
  let stopped = false;
  let recognition: OnDeviceRecognition | undefined;
  const run = () => {
    if (stopped || !Recognition) return;
    recognition = new Recognition();
    // Refuse to start if this browser can't promise on-device processing.
    if (!('processLocally' in recognition)) {
      stopped = true;
      onError();
      return;
    }
    recognition.processLocally = true;
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        onText(result[0].transcript, result.isFinal);
      }
    };
    recognition.onerror = () => {
      stopped = true;
      onError();
    };
    recognition.onend = () => run();
    recognition.start();
  };
  run();
  return () => {
    stopped = true;
    recognition?.abort();
  };
}
