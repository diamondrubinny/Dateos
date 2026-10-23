// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { matchModeSchema } from './friends.js';
import { z } from 'zod';
import { publicProfileSchema } from './discovery.js';
import { localeSchema } from './common.js';
import { callSchema, type CallStatus } from './calls.js';
import { datePlanSchema } from './dates.js';

export const MAX_MESSAGE_LENGTH = 2000;
/** Each person must send this many text messages before images unlock in a chat. */
export const MESSAGES_BEFORE_IMAGES = 3;
/** Voice messages: hard cut at 60 s, upload limit 2 MB (≈ 60 s of high-quality AAC/Opus). */
export const MAX_VOICE_SECONDS = 60;
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** Messages in unmatched chats are purged after this many days. */
export const UNMATCHED_CHAT_RETENTION_DAYS = 30;

export const harmCategories = ['insult', 'sexual', 'threat'] as const;
export const scamSignals = ['money', 'crypto', 'gift_card', 'off_platform', 'link'] as const;

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  clientId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[\w-]+$/),
});

export const messageCheckSchema = z.object({ text: z.string().max(MAX_MESSAGE_LENGTH) });
export const messageCheckResultSchema = z.object({
  flagged: z.boolean(),
  categories: z.array(z.enum(harmCategories)),
});

export const messageViewSchema = z.object({
  id: z.uuid(),
  matchId: z.uuid(),
  mine: z.boolean(),
  kind: z.enum(['text', 'image', 'voice', 'date', 'call']),
  body: z.string().nullable(),
  image: z
    .object({ url: z.string().nullable(), status: z.enum(['pending', 'clean', 'rejected']) })
    .nullable(),
  voice: z
    .object({
      url: z.string().nullable(),
      status: z.enum(['pending', 'clean', 'rejected']),
      durationMs: z.number().int().nullable(),
    })
    .nullable(),
  /** A date card (kind 'date'); its status changes are announced with message.updated. */
  date: datePlanSchema.nullable(),
  /** A call line (kind 'call'); status changes are announced with message.updated. */
  call: callSchema.nullable(),
  /** Receiver-side safety: hidden until the person chooses to show it. */
  hidden: z.boolean(),
  harm: z.array(z.enum(harmCategories)),
  scam: z.array(z.enum(scamSignals)),
  createdAt: z.string(),
});
export type MessageView = z.infer<typeof messageViewSchema>;

export const messagesPageSchema = z.object({
  messages: z.array(messageViewSchema),
  /** Cursor for older messages, or null at the start of the chat. */
  before: z.string().nullable(),
  otherReadAt: z.string().nullable(),
  imagesUnlocked: z.boolean(),
  /** False when the other person turned voice messages off. */
  otherAcceptsVoice: z.boolean(),
  /** Whether a call can be started now: community feature on, chat unlocked, receiver accepts. */
  callsAvailable: z.boolean(),
});
export type MessagesPage = z.infer<typeof messagesPageSchema>;

export const messagesQuerySchema = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const conversationSchema = z.object({
  matchId: z.uuid(),
  profile: publicProfileSchema,
  lastMessage: messageViewSchema.nullable(),
  unread: z.number().int(),
  createdAt: z.string(),
  /** Friends mode (phase 22): the inbox labels friend chats. */
  mode: matchModeSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const icebreakersSchema = z.object({ suggestions: z.array(z.string()) });

/** Server → client WebSocket events. */
export type RealtimeEvent =
  | { type: 'message.new'; matchId: string; message: MessageView }
  | { type: 'message.updated'; matchId: string; messageId: string }
  /** Phase 20: the other person changed when they're free; refetch the overlap. */
  | { type: 'availability.updated'; matchId: string }
  | { type: 'message.read'; matchId: string; at: string }
  | { type: 'typing'; matchId: string }
  | { type: 'match.new'; matchId: string }
  | { type: 'match.closed'; matchId: string }
  | { type: 'call.incoming'; matchId: string; callId: string; video: boolean }
  | { type: 'call.updated'; matchId: string; callId: string; status: CallStatus }
  /** Double dates (phase 22): a new group chat of four, a message in it, or it closed. */
  | { type: 'double.new'; doubleId: string }
  | { type: 'double.message'; doubleId: string }
  | { type: 'double.closed'; doubleId: string };

/** Client → server WebSocket messages. */
export const clientEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('typing'), matchId: z.uuid() }),
  z.object({ type: z.literal('ping') }),
]);

/** Redis pub/sub channel carrying RealtimeEvents for one user (all API instances listen). */
export function realtimeChannel(userId: string): string {
  return `nexaheart:rt:user:${userId}`;
}
export const REALTIME_PATTERN = 'nexaheart:rt:user:*';

export const chatSettingsSchema = z.object({ acceptVoice: z.boolean(), acceptCalls: z.boolean() });
export const chatSettingsInputSchema = chatSettingsSchema
  .partial()
  .refine((v) => v.acceptVoice !== undefined || v.acceptCalls !== undefined, 'Nothing to change');

/** Expo push tokens look like ExponentPushToken[xxxxxxxx]. 📘 Expo push documentation. */
export const pushTokenInputSchema = z.object({
  token: z
    .string()
    .max(200)
    .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/),
  platform: z.enum(['ios', 'android']),
  locale: localeSchema.default('en'),
});
