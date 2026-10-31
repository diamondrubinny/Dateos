// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Phase 68d: a chaperone (wali) a member chooses: read-only access to their dating chats, from
 * the day they joined, text only, with a notice the other side always sees. See
 * docs/phases/PHASE-68.md.
 */
export const CHAPERONE_LINK_DAYS = 7;

const person = z.object({ displayName: z.string(), since: z.string() });

/** The member's own view in Settings. */
export const myChaperoneSchema = z.object({
  chaperone: person.extend({ lastViewedAt: z.string().nullable() }).nullable(),
});
export type MyChaperone = z.infer<typeof myChaperoneSchema>;

/** The notice in a chat: my chaperone, and the other person's (both may be null). */
export const chatChaperonesSchema = z.object({
  mine: person.nullable(),
  theirs: person.nullable(),
});
export type ChatChaperones = z.infer<typeof chatChaperonesSchema>;

export const chaperoneLinkInfoSchema = z.object({ memberName: z.string() });
export const chaperoneJoinSchema = z.object({ token: z.string().min(20).max(64) }).strict();

/** The chaperone's list: whom they chaperone and those members' dating chats. */
export const chaperoningSchema = z.object({
  members: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      since: z.string(),
      chats: z.array(z.object({ matchId: z.uuid(), otherName: z.string() })),
    }),
  ),
});
export type Chaperoning = z.infer<typeof chaperoningSchema>;

export const chaperoneMessageKinds = ['text', 'image', 'voice', 'date', 'call'] as const;

/** Read-only: messages from the start, text only (other kinds as a placeholder). */
export const chaperoneTranscriptSchema = z.object({
  memberName: z.string(),
  otherName: z.string(),
  since: z.string(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      fromMember: z.boolean(),
      kind: z.enum(chaperoneMessageKinds),
      text: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type ChaperoneTranscript = z.infer<typeof chaperoneTranscriptSchema>;
