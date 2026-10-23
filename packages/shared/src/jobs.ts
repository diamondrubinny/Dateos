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

/** Voice transcripts (phase 26): one at a time, on the community's own server. */
export const TRANSCRIBE_QUEUE = 'transcribe';

export const TranscribeJob = {
  Transcribe: 'transcribe',
} as const;

export interface TranscribeJobData {
  audioId: string;
}

/** Integrations (phase 24): webhooks and team alerts, delivered by the worker with retries. */
export const OUTBOUND_QUEUE = 'outbound';

export const OutboundJob = {
  Webhook: 'webhook',
  Alert: 'alert',
} as const;

/** A webhook to deliver: the event and opaque ids only. */
export interface WebhookJob {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, string>;
}

/** A line for the team's chat: built from counts, with a link to the dashboard. */
export interface AlertJob {
  event: string;
  text: string;
}
