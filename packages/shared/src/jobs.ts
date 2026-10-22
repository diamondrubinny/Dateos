// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/** Background job contracts shared by the API (producer) and the worker (consumer). */
export const MEDIA_QUEUE = 'media';

export const MediaJob = {
  ProcessPhoto: 'process-photo',
  ProcessAudio: 'process-audio',
  DeleteObjects: 'delete-objects',
} as const;

export interface ProcessAudioJob {
  audioId: string;
  /** Shorter limit than a voice message, e.g. a voice prompt (phase 19). */
  maxSeconds?: number;
}

export interface ProcessPhotoJob {
  photoId: string;
}

export interface DeleteObjectsJob {
  quarantineKeys: string[];
  mediaKeys: string[];
}

export const PROFILE_QUEUE = 'profile';

export const ProfileJob = {
  EmbedProfile: 'embed-profile',
} as const;

export interface EmbedProfileJob {
  userId: string;
}

export const NOTIFY_QUEUE = 'notify';

export const NotifyJob = {
  Push: 'push',
} as const;

/** Pushes carry no names or message text: they pass through Expo, Apple and Google. */
export interface PushJob {
  userId: string;
  kind: 'message' | 'match' | 'checkin' | 'event' | 'call' | 'visible';
  /**
   * For 'checkin': the check-in id; for 'event': the event id; for 'call': the match id; for
   * 'visible' (a break ended): the member's own id.
   */
  matchId: string;
}
