/** Background job contracts shared by the API (producer) and the worker (consumer). */
export const MEDIA_QUEUE = 'media';

export const MediaJob = {
  ProcessPhoto: 'process-photo',
  DeleteObjects: 'delete-objects',
} as const;

export interface ProcessPhotoJob {
  photoId: string;
}

export interface DeleteObjectsJob {
  quarantineKeys: string[];
  mediaKeys: string[];
}
