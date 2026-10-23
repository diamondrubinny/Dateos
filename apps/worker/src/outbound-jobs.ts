// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  alertTargetFrom,
  deliverWebhook,
  type IntegrationStore,
  type OutboundOptions,
  reportError,
  type WebhookPayload,
  sendAlert,
} from '@nexaheart/integrations';
import { type AlertJob, OutboundJob, type WebhookJob } from '@nexaheart/shared';
import { lt, sql } from 'drizzle-orm';

export interface OutboundContext {
  db: Database;
  store: IntegrationStore;
  options: OutboundOptions;
  instanceName: string;
  /** For links in alerts. */
  adminUrl: string;
  now?: () => Date;
}

/** Webhook deliveries are kept this long (status only, no payloads). */
export const DELIVERY_RETENTION_DAYS = 30;

/**
 * Delivers one webhook or alert. A failure throws, so BullMQ retries with backoff; each attempt of
 * a webhook is recorded (event type and status only).
 */
export async function processOutbound(
  ctx: OutboundContext,
  job: { name: string; data: unknown; attemptsMade: number },
): Promise<string> {
  if (job.name === OutboundJob.Webhook) {
    const cfg = await ctx.store.get('webhooks');
    if (!cfg.enabled) return 'off';
    const payload = job.data as WebhookJob & WebhookPayload;
    const result = await deliverWebhook(
      { url: String(cfg.settings.url ?? ''), signingSecret: cfg.secrets.signingSecret ?? '' },
      payload,
      ctx.options,
    );
    await ctx.db.insert(schema.webhookDeliveries).values({
      event: payload.type.slice(0, 40),
      status: result.status,
      ok: result.ok,
      attempt: job.attemptsMade + 1,
    });
    if (!result.ok) throw new Error(result.message);
    return 'delivered';
  }
  if (job.name === OutboundJob.Alert) {
    const cfg = await ctx.store.get('alerts');
    if (!cfg.enabled) return 'off';
    const result = await sendAlert(alertTargetFrom(cfg), (job.data as AlertJob).text, ctx.options);
    if (!result.ok) throw new Error(result.message);
    return 'delivered';
  }
  throw new Error(`Unknown job: ${job.name}`);
}

/**
 * The team's morning summary (if asked for): counts only. Also deletes old delivery records.
 */
export async function dailySummary(
  ctx: OutboundContext,
): Promise<{ sent: boolean; deleted: number }> {
  const now = ctx.now?.() ?? new Date();
  const deleted = await ctx.db
    .delete(schema.webhookDeliveries)
    .where(
      lt(
        schema.webhookDeliveries.createdAt,
        new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000),
      ),
    );
  const cfg = await ctx.store.get('alerts');
  const wanted = String(cfg.settings.events ?? '')
    .split(',')
    .includes('daily_summary');
  if (!cfg.enabled || !wanted) return { sent: false, deleted: deleted.rowCount ?? 0 };
  const since = new Date(now.getTime() - 86_400_000);
  const { rows } = await ctx.db.execute<{
    open: number;
    urgent: number;
    waiting: number;
    joined: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM reports WHERE status = 'open') AS open,
      (SELECT count(*)::int FROM reports WHERE status = 'open' AND priority = 'urgent') AS urgent,
      (SELECT count(*)::int FROM waitlist WHERE status = 'pending') AS waiting,
      (SELECT count(*)::int FROM profiles WHERE created_at >= ${since}) AS joined`);
  const c = rows[0] ?? { open: 0, urgent: 0, waiting: 0, joined: 0 };
  const text =
    `☀️ ${ctx.instanceName} today: ${c.open} open reports (${c.urgent} urgent), ` +
    `${c.waiting} on the waitlist, ${c.joined} new members in the last day. ${ctx.adminUrl}`;
  const result = await sendAlert(alertTargetFrom(cfg), text, ctx.options);
  return { sent: result.ok, deleted: deleted.rowCount ?? 0 };
}

/** Failed jobs go to error monitoring, if it's set up: the job's name and a scrubbed error. */
export async function reportJobError(
  ctx: Pick<OutboundContext, 'store' | 'options'>,
  jobName: string,
  error: Error,
): Promise<void> {
  try {
    const cfg = await ctx.store.get('errors');
    if (!cfg.enabled || !cfg.secrets.dsn) return;
    await reportError(
      cfg.secrets.dsn,
      { type: error.name, message: error.message, stack: error.stack },
      {
        environment: String(cfg.settings.environment || 'production'),
        platform: 'node',
        tags: { app: 'worker', job: jobName },
      },
      ctx.options,
    );
  } catch {
    // Monitoring must never break the worker.
  }
}

/** The push settings now: the server's environment, else the dashboard's. */
export async function pushSettings(
  store: IntegrationStore,
  env: { PUSH_PROVIDER: 'disabled' | 'expo'; EXPO_ACCESS_TOKEN?: string | undefined },
): Promise<{ provider: 'disabled' | 'expo'; expoAccessToken?: string | undefined }> {
  const cfg = await store.get('push');
  if (cfg.source !== 'dashboard') {
    return { provider: env.PUSH_PROVIDER, expoAccessToken: env.EXPO_ACCESS_TOKEN };
  }
  return cfg.enabled
    ? { provider: 'expo', expoAccessToken: cfg.secrets.accessToken }
    : { provider: 'disabled' };
}
