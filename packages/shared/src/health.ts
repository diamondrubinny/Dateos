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
