// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { usePreventScreenCapture } from 'expo-screen-capture';

/**
 * Screenshot protection (phase 21) on chats, profiles and calls: Android blocks screenshots and
 * screen recording (FLAG_SECURE); iOS blocks screen recording. Lifted when the screen closes.
 * (Behaviour per platform: verify against the expo-screen-capture docs.)
 */
export function useNoScreenCapture(): void {
  usePreventScreenCapture();
}

export const screenCaptureBlocked = true;
