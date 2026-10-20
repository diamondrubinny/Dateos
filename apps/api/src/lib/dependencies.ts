import { Redis } from 'ioredis';

/** A backing service the API needs in order to serve traffic. */
export interface Dependency {
  readonly name: string;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}

const CHECK_TIMEOUT_MS = 2_000;

async function withTimeout(task: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([task.then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createRedis(redisUrl: string): Dependency & { client: Redis } {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });
  client.on('error', () => undefined);
  return {
    name: 'redis',
    client,
    isHealthy: () => withTimeout(client.ping()),
    close: async () => {
      await client.quit().catch(() => client.disconnect());
    },
  };
}
