import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import { CALL_RING_SECONDS } from '@nexaheart/shared';
import type { Env } from '../config/env.js';

/** Who someone is inside a call room. Member ids are never sent to LiveKit or the other person. */
export type CallRole = 'caller' | 'callee';

export interface CallWebhookEvent {
  event: string;
  room: string;
  role: CallRole | null;
}

/** The media server, behind a small interface so tests run without LiveKit. */
export interface CallMedia {
  /** Public address the apps connect to. */
  readonly url: string;
  createRoom(room: string): Promise<void>;
  /** Disconnects everyone. Never fails for a room that is already gone. */
  deleteRoom(room: string): Promise<void>;
  joinToken(input: {
    room: string;
    role: CallRole;
    video: boolean;
    ttlSeconds: number;
    /** End-to-end encryption: shown to the other person as this participant's `pk` attribute. */
    publicKey: string;
  }): Promise<string>;
  /** Verifies LiveKit's signature; null for anything unsigned or forged. */
  receiveWebhook(body: string, authorization: string | undefined): Promise<CallWebhookEvent | null>;
}

export function liveKitConfigured(env: Env): boolean {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

export function apiUrlFor(env: Pick<Env, 'LIVEKIT_URL' | 'LIVEKIT_API_URL'>): string {
  return env.LIVEKIT_API_URL ?? env.LIVEKIT_URL!.replace(/^ws/, 'http');
}

export function createLiveKitMedia(env: Env): CallMedia | null {
  if (!liveKitConfigured(env)) return null;
  const key = env.LIVEKIT_API_KEY!;
  const secret = env.LIVEKIT_API_SECRET!;
  const rooms = new RoomServiceClient(apiUrlFor(env), key, secret);
  const webhooks = new WebhookReceiver(key, secret);
  return {
    url: env.LIVEKIT_URL!,
    async createRoom(room) {
      await rooms.createRoom({
        name: room,
        maxParticipants: 2,
        // Closed if nobody joins, and soon after the last person leaves.
        emptyTimeout: CALL_RING_SECONDS + 15,
        departureTimeout: 20,
      });
    },
    async deleteRoom(room) {
      try {
        await rooms.deleteRoom(room);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    },
    async joinToken({ room, role, video, ttlSeconds, publicKey }) {
      const token = new AccessToken(key, secret, {
        identity: role,
        ttl: ttlSeconds,
        attributes: { pk: publicKey },
      });
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        // Captions (phase 16c) travel as text in the call, end-to-end encrypted like the media.
        canPublishData: true,
        canUpdateOwnMetadata: false,
        // No screen sharing; a voice call can't turn into a video call.
        canPublishSources: video
          ? [TrackSource.CAMERA, TrackSource.MICROPHONE]
          : [TrackSource.MICROPHONE],
      });
      return token.toJwt();
    },
    async receiveWebhook(body, authorization) {
      if (!authorization) return null;
      try {
        const event = await webhooks.receive(body, authorization);
        const identity = event.participant?.identity;
        return {
          event: event.event,
          room: event.room?.name ?? '',
          role: identity === 'caller' || identity === 'callee' ? identity : null,
        };
      } catch {
        return null;
      }
    },
  };
}
