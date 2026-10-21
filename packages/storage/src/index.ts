import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  quarantineBucket: string;
  mediaBucket: string;
}

export interface StoredObject {
  body: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
}

export interface Storage {
  readonly buckets: { quarantine: string; media: string };
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  get(bucket: string, key: string): Promise<StoredObject>;
  getBuffer(bucket: string, key: string): Promise<Buffer>;
  /** Deletes keys in batches; missing keys are ignored. */
  delete(bucket: string, keys: string[]): Promise<void>;
  listKeys(bucket: string, prefix: string): Promise<string[]>;
  /** Creates the buckets if they do not exist (idempotent). */
  ensureBuckets(): Promise<void>;
  isHealthy(): Promise<boolean>;
  close(): void;
}

const DELETE_BATCH = 1000;

export function createStorage(config: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const buckets = { quarantine: config.quarantineBucket, media: config.mediaBucket };

  async function get(bucket: string, key: string): Promise<StoredObject> {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error('Empty object body');
    return {
      body: res.Body as Readable,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    };
  }

  return {
    buckets,
    async put(bucket, key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    get,
    async getBuffer(bucket, key) {
      const { body } = await get(bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
      return Buffer.concat(chunks);
    },
    async delete(bucket, keys) {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    },
    async listKeys(bucket, prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of res.Contents ?? []) if (object.Key) keys.push(object.Key);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async ensureBuckets() {
      for (const bucket of Object.values(buckets)) {
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }));
        } catch {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
        }
      }
    },
    async isHealthy() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: buckets.media }));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      client.destroy();
    },
  };
}

export function quarantineKey(userId: string, photoId: string): string {
  return `photos/${userId}/${photoId}`;
}

export function mediaKey(userId: string, photoId: string): string {
  return `photos/${userId}/${photoId}.webp`;
}

export function audioQuarantineKey(userId: string, audioId: string): string {
  return `audio/${userId}/${audioId}`;
}

export function audioMediaKey(
  userId: string,
  audioId: string,
  format: 'm4a' | 'webm' = 'm4a',
): string {
  return `audio/${userId}/${audioId}.${format}`;
}

/** Copies of reported media, kept with the report instead of the chat. */
export function evidenceKey(reportId: string, evidenceId: string, extension: string): string {
  return `evidence/${reportId}/${evidenceId}.${extension}`;
}
