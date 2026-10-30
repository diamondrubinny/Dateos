// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/** Updates from GitHub (phase 53): see docs/phases/PHASE-53.md. */
export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/, 'A full commit id.');
export const updateRequestStatuses = ['pending', 'running', 'done', 'failed', 'cancelled'] as const;
export type UpdateRequestStatus = (typeof updateRequestStatuses)[number];
/** A request nobody picked up for this long: the server's updater probably isn't set up. */
export const UPDATE_PICKUP_MINUTES = 5;

export const updateChangeSchema = z.object({
  title: z.string(),
  number: z.number().int().nullable(),
  at: z.string(),
});
export type UpdateChange = z.infer<typeof updateChangeSchema>;

export const updateRequestSchema = z.object({
  id: z.uuid(),
  status: z.enum(updateRequestStatuses),
  target: commitSchema,
  from: commitSchema.nullable(),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  message: z.string().nullable(),
});
export type UpdateRequest = z.infer<typeof updateRequestSchema>;

export const updateStatusViewSchema = z.object({
  /** UPDATE_CHECK=on in the server's .env. */
  enabled: z.boolean(),
  /** UPDATE_EMAILS=on: admins are emailed when a version is available and when one finishes. */
  emails: z.boolean(),
  repo: z.string(),
  branch: z.string(),
  /** The commit this server runs, or null when it isn't known (installed without the script). */
  current: commitSchema.nullable(),
  checkedAt: z.string().nullable(),
  latest: commitSchema.nullable(),
  latestAt: z.string().nullable(),
  /** Commits the branch is ahead; 0 is up to date. */
  behind: z.number().int(),
  changes: z.array(updateChangeSchema),
  /** Why the last check didn't work, or 'unknown-version'. */
  error: z.string().nullable(),
  /** The latest request (approval) and what happened to it. */
  request: updateRequestSchema.nullable(),
});
export type UpdateStatusView = z.infer<typeof updateStatusViewSchema>;

export const installUpdateSchema = z.object({ commit: commitSchema }).strict();
export type InstallUpdate = z.infer<typeof installUpdateSchema>;
