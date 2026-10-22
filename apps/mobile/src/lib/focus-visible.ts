// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Web equivalent of CSS :focus-visible for react-native-web Pressables: focus rings appear
 * for keyboard users and stay hidden after mouse or touch clicks.
 */
let keyboardMode = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (keyboardMode === next) return;
  keyboardMode = next;
  listeners.forEach((listener) => listener());
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ')
        set(true);
    },
    true,
  );
  window.addEventListener('pointerdown', () => set(false), true);
}

export function useKeyboardMode(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => keyboardMode,
    () => false,
  );
}
