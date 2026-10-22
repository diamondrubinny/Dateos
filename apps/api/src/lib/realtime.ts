import { REALTIME_PATTERN, realtimeChannel, type RealtimeEvent } from '@dateos/shared';
import { Redis } from 'ioredis';

export interface RealtimeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Realtime {
  /** Delivers an event to every open connection of `userId`, on any API instance. */
  publish(userId: string, event: RealtimeEvent): Promise<void>;
  /** Tracks a connection; returns an unregister function. */
  register(userId: string, socket: RealtimeSocket): () => void;
  /**
   * Marks a person as online (any open connection on any API instance) for `ttlSeconds`.
   * The worker skips push notifications for people who are online.
   */
  touchPresence(userId: string, ttlSeconds?: number): Promise<void>;
  clearPresence(userId: string): Promise<void>;
  /** Open connections on this instance (for tests and metrics). */
  connections(userId: string): number;
  close(): Promise<void>;
}

const PREFIX = realtimeChannel('');

export const presenceKey = (userId: string) => `dateos:presence:${userId}`;

export function createRealtime(
  redisUrl: string,
  onError: (error: unknown) => void = () => undefined,
): Realtime {
  const pub = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  const sub = new Redis(redisUrl);
  pub.on('error', onError);
  sub.on('error', onError);
  const sockets = new Map<string, Set<RealtimeSocket>>();

  void sub.psubscribe(REALTIME_PATTERN).catch(onError);
  sub.on('pmessage', (_pattern: string, channel: string, payload: string) => {
    const userId = channel.slice(PREFIX.length);
    for (const socket of sockets.get(userId) ?? []) {
      try {
        socket.send(payload);
      } catch (error) {
        onError(error);
      }
    }
  });

  return {
    async publish(userId, event) {
      await pub.publish(realtimeChannel(userId), JSON.stringify(event));
    },
    register(userId, socket) {
      let set = sockets.get(userId);
      if (!set) sockets.set(userId, (set = new Set()));
      set.add(socket);
      return () => {
        set.delete(socket);
        if (set.size === 0) sockets.delete(userId);
      };
    },
    async touchPresence(userId, ttlSeconds = 75) {
      await pub.set(presenceKey(userId), '1', 'EX', ttlSeconds);
    },
    async clearPresence(userId) {
      // Another API instance may still hold a connection; its next heartbeat sets the key again.
      if (!sockets.has(userId)) await pub.del(presenceKey(userId));
    },
    connections: (userId) => sockets.get(userId)?.size ?? 0,
    async close() {
      for (const set of sockets.values())
        for (const socket of set) socket.close(1001, 'server shutting down');
      sockets.clear();
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
