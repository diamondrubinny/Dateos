// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { matchModeSchema } from './friends.js';
import { z } from 'zod';
import { publicProfileSchema } from './discovery.js';
import { deviceSecretSchema } from './account.js';
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

/** Phase 30: my own message can be unsent this long after sending. */
export const UNSEND_MINUTES = 15;
/** Phase 30: an unsent message's content is kept this long, for moderation only. */
export const UNSENT_KEEP_DAYS = 30;
/** Phase 30: how much of a quoted message a reply shows. */
export const REPLY_PREVIEW_LENGTH = 120;

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  clientId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[\w-]+$/),
  /** Phase 30: a message in the same chat. */
  replyToId: z.uuid().optional(),
});

export const messageCheckSchema = z.object({ text: z.string().max(MAX_MESSAGE_LENGTH) });
export const messageCheckResultSchema = z.object({
  flagged: z.boolean(),
  categories: z.array(z.enum(harmCategories)),
});

/** Reactions to messages (phase 29b): a fixed list keeps them translatable and free of abuse. */
export const reactionEmojis = ['❤️', '😂', '😮', '😢', '👍', '🔥'] as const;
export const reactionEmojiSchema = z.enum(reactionEmojis);
export type ReactionEmoji = z.infer<typeof reactionEmojiSchema>;
/** Words for screen readers, per emoji (the apps translate them). */
export const reactionKeys: Record<ReactionEmoji, string> = {
  '❤️': 'heart',
  '😂': 'laugh',
  '😮': 'wow',
  '😢': 'sad',
  '👍': 'thumbsUp',
  '🔥': 'fire',
};
/** null removes my reaction. */
export const reactInputSchema = z.object({ emoji: reactionEmojiSchema.nullable() });

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
  /** Phase 29b: one each at most, in a chat of two. */
  reactions: z.object({
    mine: reactionEmojiSchema.nullable(),
    theirs: reactionEmojiSchema.nullable(),
  }),
  /** Phase 30: unsent by its sender; nothing of it is shown. */
  unsent: z.boolean(),
  /** Phase 30: the quoted message, as much as this viewer may see of it. */
  replyTo: z
    .object({
      id: z.uuid(),
      mine: z.boolean(),
      kind: z.enum(['text', 'image', 'voice', 'date', 'call']),
      /** The first REPLY_PREVIEW_LENGTH characters of a text; null otherwise. */
      preview: z.string().nullable(),
      state: z.enum(['shown', 'hidden', 'unsent']),
    })
    .nullable(),
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
  /** Phase 31: my private choices for this chat. */
  muted: z.boolean(),
  archived: z.boolean(),
});

/** Search in a chat (phase 32). */
export const chatSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
export const chatSearchResultSchema = z.object({
  results: z.array(
    z.object({ id: z.uuid(), mine: z.boolean(), body: z.string(), createdAt: z.string() }),
  ),
});
export type ChatSearchResult = z.infer<typeof chatSearchResultSchema>;

export const matchPrefsInputSchema = z
  .object({ muted: z.boolean().optional(), archived: z.boolean().optional() })
  .refine((v) => v.muted !== undefined || v.archived !== undefined, 'Nothing to change');
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
  | { type: 'double.closed'; doubleId: string }
  /** Partner communities (phase 28c): a message in a match across communities, or matches changed. */
  | { type: 'federated.message'; matchId: string }
  | { type: 'federated.matches' };

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

export const chatSettingsSchema = z.object({
  acceptVoice: z.boolean(),
  acceptCalls: z.boolean(),
  /** Phase 26: people I send voice to may read it as text (made on this community's server). */
  allowTranscripts: z.boolean(),
  /** Phase 30: "Seen" both ways; off hides mine and theirs. */
  readReceipts: z.boolean(),
  /** Phase 32: an email when a new kind of device signs in. */
  signinAlerts: z.boolean(),
  /** Phase 33: push notifications by kind (calls and safety alerts are always on). */
  notifyMatches: z.boolean(),
  notifyMessages: z.boolean(),
  notifyEvents: z.boolean(),
});
export const chatSettingsInputSchema = chatSettingsSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

/** Expo push tokens look like ExponentPushToken[xxxxxxxx]. 📘 Expo push documentation. */
export const pushTokenInputSchema = z.object({
  token: z
    .string()
    .max(200)
    .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/),
  platform: z.enum(['ios', 'android']),
  locale: localeSchema.default('en'),
  /**
   * Binds the token to this installation (phase 29): an already registered token moves to another
   * account only with the same secret. Optional for apps from before phase 29.
   */
  deviceSecret: deviceSecretSchema.optional(),
});
