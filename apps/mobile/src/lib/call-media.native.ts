// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { AudioSession, registerGlobals } from '@livekit/react-native';
import type { RemoteTrack } from 'livekit-client';

let registered = false;

/** iOS and Android: WebRTC comes from the native module, and the call needs an audio session. */
export async function prepareCallMedia(): Promise<void> {
  if (!registered) {
    registerGlobals();
    registered = true;
  }
  await AudioSession.startAudioSession();
}

export async function releaseCallMedia(): Promise<void> {
  await AudioSession.stopAudioSession();
}

/** Native WebRTC plays remote audio by itself. */
export function attachAudio(_track: RemoteTrack): () => void {
  return () => undefined;
}
