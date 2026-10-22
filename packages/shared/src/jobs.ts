/** Background job contracts shared by the API (producer) and the worker (consumer). */
export const MEDIA_QUEUE = 'media';

export const MediaJob = {
  ProcessPhoto: 'process-photo',
  ProcessAudio: 'process-audio',
  DeleteObjects: 'delete-objects',
} as const;

export interface ProcessAudioJob {
  audioId: string;
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
  kind: 'message' | 'match' | 'checkin' | 'event';
  /** For 'checkin': the check-in id; for 'event': the event id. */
  matchId: string;
}
