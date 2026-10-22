import { RNE2EEManager, RNKeyProvider } from '@livekit/react-native';
import type { RoomOptions } from 'livekit-client';

/** iOS and Android: frames and data packets are encrypted by the native WebRTC module. */
export interface CallEncryption {
  roomOptions: Partial<RoomOptions>;
  setKey(key: Uint8Array): Promise<void>;
  dispose(): void;
}

export function encryptionSupported(): boolean {
  return true;
}

export function createCallEncryption(): CallEncryption {
  const keyProvider = new RNKeyProvider({});
  return {
    roomOptions: { encryption: { e2eeManager: new RNE2EEManager(keyProvider, true) } },
    setKey: async (key) => {
      await keyProvider.setSharedKey(key);
    },
    dispose: () => keyProvider.dispose(),
  };
}
