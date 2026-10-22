// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ExternalE2EEKeyProvider, isE2EESupported, type RoomOptions } from 'livekit-client';

/** Web: LiveKit's encryption worker (copied into the build) encrypts every frame and data packet. */
export interface CallEncryption {
  roomOptions: Partial<RoomOptions>;
  setKey(key: Uint8Array): Promise<void>;
  dispose(): void;
}

/** Browsers without Insertable Streams / RTCRtpScriptTransform can't make private calls. */
export function encryptionSupported(): boolean {
  return typeof Worker !== 'undefined' && isE2EESupported();
}

export function createCallEncryption(): CallEncryption {
  const keyProvider = new ExternalE2EEKeyProvider();
  const worker = new Worker('/livekit-e2ee-worker.mjs', { type: 'module' });
  return {
    roomOptions: { encryption: { keyProvider, worker } },
    setKey: async (key) => {
      await keyProvider.setKey(key.slice().buffer);
    },
    dispose: () => worker.terminate(),
  };
}
