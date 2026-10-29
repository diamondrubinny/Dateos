// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), dependencyStatusSchema),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

/** A backup older than this is flagged in the dashboard (phase 51): the cron runs daily. */
export const BACKUP_STALE_HOURS = 36;

/** The dashboard's System page (phase 51): admins only. No personal data. */
export const systemStatusSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), dependencyStatusSchema),
  backup: z.object({
    /** The last backup scripts/backup.sh finished, or null if none was ever recorded. */
    lastAt: z.string().nullable(),
    bytes: z.number().int().nullable(),
    /** No backup, or the last one is older than BACKUP_STALE_HOURS. */
    stale: z.boolean(),
  }),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;
