// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { RemoteTrack } from 'livekit-client';

/** Web: the browser has WebRTC built in; nothing to set up. */
export async function prepareCallMedia(): Promise<void> {}
export async function releaseCallMedia(): Promise<void> {}

/** Plays the other person's audio through a hidden <audio> element. Returns a cleanup. */
export function attachAudio(track: RemoteTrack): () => void {
  const element = track.attach();
  element.setAttribute('aria-hidden', 'true');
  element.style.display = 'none';
  document.body.appendChild(element);
  return () => {
    track.detach(element);
    element.remove();
  };
}
