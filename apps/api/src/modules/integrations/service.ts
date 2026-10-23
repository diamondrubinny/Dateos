// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { connect } from 'node:net';
import { ollamaModel, openAiCompatibleModel, type TextModel } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  alertTargetFrom,
  checkUrl,
  deliverWebhook,
  type IntegrationStore,
  IntegrationInputError,
  type OutboundOptions,
  parseDsn,
  reportError,
  type ResolvedIntegration,
  safeFetch,
  sendAlert,
  verifyCaptcha,
  webhookPayload,
} from '@nexaheart/integrations';
import {
  type AlertEvent,
  type AnalyticsProvider,
  type CaptchaProvider,
  ErrorCode,
  type IntegrationId,
  type IntegrationUpdate,
  type PublicIntegrations,
  type WebhookEvent,
} from '@nexaheart/shared';
import { desc } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { type CallMedia, createLiveKitMedia } from '../../lib/livekit.js';
import type { OutboundQueue } from '../../lib/queue.js';
import { HttpError } from '../../plugins/error-handler.js';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A small cache keyed by the settings that built the value (rebuilt when they change). */
function memo<T>() {
  let key = '';
  let value: T | undefined;
  return (k: string, build: () => T): T => {
    if (k !== key || value === undefined) {
      key = k;
      value = build();
    }
    return value;
  };
}

export interface IntegrationDeps {
  env: Env;
  outbound: OutboundQueue | null;
  storage: { isHealthy(): Promise<boolean> };
  /** Tests replace the network. */
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
  /** Static overrides from tests (they win over everything). */
  textModel?: TextModel | null;
  callMedia?: CallMedia | null;
}

/**
 * Integrations (phase 24): reads the current configuration (env first, then the dashboard) for
 * the rest of the API, runs the dashboard's tests, and queues webhooks and team alerts.
 */
export class IntegrationService {
  private readonly aiCache = memo<TextModel | null>();
  private readonly mediaCache = memo<CallMedia | null>();
  private readonly mailCache = memo<Transporter>();
  private errorsSent: number[] = [];

  constructor(
    private readonly db: Database,
    readonly store: IntegrationStore,
    private readonly deps: IntegrationDeps,
    private readonly now: () => number = Date.now,
  ) {}

  private get outboundOptions(): OutboundOptions {
    return {
      allowPrivate: this.deps.env.INTEGRATIONS_ALLOW_PRIVATE,
      ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
      ...(this.deps.resolve ? { resolve: this.deps.resolve } : {}),
    };
  }

  // -------------------------------------------------------------- the dashboard

  async list() {
    return { integrations: await this.store.list(), editable: this.store.editable };
  }

  async save(actorId: string, id: IntegrationId, update: IntegrationUpdate) {
    let fields: string[];
    try {
      fields = await this.store.save(id, update, actorId);
    } catch (error) {
      if (error instanceof IntegrationInputError) {
        throw new HttpError(422, ErrorCode.ValidationError, error.message);
      }
      throw error;
    }
    // Which fields changed, never their values.
    await audit(this.db, {
      actorId,
      action: 'integration.update',
      targetType: 'integration',
      targetId: id,
      meta: { fields: fields.join(',') },
    });
    return this.view(id);
  }

  async remove(actorId: string, id: IntegrationId) {
    const current = await this.store.get(id);
    if (current.source === 'env') {
      throw new HttpError(409, ErrorCode.Conflict, 'This integration is set on the server.');
    }
    await this.store.remove(id);
    await audit(this.db, {
      actorId,
      action: 'integration.remove',
      targetType: 'integration',
      targetId: id,
    });
    return this.view(id);
  }

  private async view(id: IntegrationId) {
    return (await this.store.list()).find((v) => v.id === id)!;
  }

  async test(actorId: string, id: IntegrationId): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.store.get(id);
    let result: { ok: boolean; message: string };
    try {
      result =
        !cfg.enabled && !['storage', 'antivirus'].includes(id)
          ? { ok: false, message: 'Turn it on and save first.' }
          : await this.runTest(cfg);
    } catch (error) {
      result = { ok: false, message: (error as Error).message.slice(0, 200) || 'It failed.' };
    }
    await this.store.recordTest(id, result.ok, result.message);
    await audit(this.db, {
      actorId,
      action: 'integration.test',
      targetType: 'integration',
      targetId: id,
      meta: { ok: result.ok },
    });
    return result;
  }

  private async runTest(cfg: ResolvedIntegration): Promise<{ ok: boolean; message: string }> {
    const s = cfg.settings;
    const o = this.outboundOptions;
    switch (cfg.id) {
      case 'email': {
        await this.checkHost(str(s.host));
        await this.transport(cfg).verify();
        return { ok: true, message: 'The mail server accepted the connection and the login.' };
      }
      case 'google':
      case 'apple':
        return {
          ok: true,
          message: 'Saved. Restart the API to use it, then try signing in to check it.',
        };
      case 'captcha': {
        // A made-up answer: a good secret key gets "invalid response", a bad one "invalid secret".
        const res = await safeFetch(
          s.provider === 'hcaptcha'
            ? 'https://api.hcaptcha.com/siteverify'
            : 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret: cfg.secrets.secretKey ?? '', response: 'test' }),
          },
          { ...o, allowPrivate: false },
        );
        const data = (await res.json().catch(() => ({}))) as { 'error-codes'?: string[] };
        const codes = data['error-codes'] ?? [];
        return codes.some((c) => c.includes('secret'))
          ? { ok: false, message: 'The provider refused the secret key.' }
          : { ok: true, message: 'The provider accepted the secret key.' };
      }
      case 'ai': {
        const model = await this.aiModel();
        if (!model) return { ok: false, message: 'The model isn’t configured.' };
        const reply = await model.complete({
          system: 'Reply with the single word OK.',
          user: 'Test',
          temperature: 0,
          maxTokens: 5,
        });
        return reply
          ? { ok: true, message: 'The model answered.' }
          : { ok: false, message: 'The model didn’t answer.' };
      }
      case 'video': {
        const media = await this.media();
        if (!media?.check) return { ok: false, message: 'Video isn’t configured.' };
        await media.check();
        return { ok: true, message: 'LiveKit accepted the API key and secret.' };
      }
      case 'push': {
        // 📘 https://docs.expo.dev/push-notifications/sending-notifications/#additional-security
        const res = await safeFetch(
          'https://exp.host/--/api/v2/push/getReceipts',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cfg.secrets.accessToken
                ? { authorization: `Bearer ${cfg.secrets.accessToken}` }
                : {}),
            },
            body: JSON.stringify({ ids: [] }),
          },
          { ...o, allowPrivate: false },
        );
        return res.ok
          ? { ok: true, message: 'Expo accepted the request.' }
          : { ok: false, message: `Expo answered ${res.status}.` };
      }
      case 'errors': {
        const r = await reportError(
          cfg.secrets.dsn ?? '',
          { type: 'NexaHeartTest', message: 'A test event from the dashboard. You can ignore it.' },
          { environment: str(s.environment) || 'production', platform: 'node' },
          o,
        );
        return { ok: r.ok, message: r.ok ? 'A test event was sent.' : r.message };
      }
      case 'analytics': {
        const res = await safeFetch(analyticsScript(cfg), { method: 'GET' }, o);
        return res.ok
          ? { ok: true, message: 'The analytics script is reachable.' }
          : { ok: false, message: `The server answered ${res.status}.` };
      }
      case 'alerts': {
        const r = await sendAlert(
          alertTargetFrom(cfg),
          `✅ ${this.deps.env.INSTANCE_NAME}: a test message from the dashboard.`,
          o,
        );
        return { ok: r.ok, message: r.message };
      }
      case 'webhooks': {
        const r = await deliverWebhook(
          { url: str(s.url), signingSecret: cfg.secrets.signingSecret ?? '' },
          webhookPayload('test', {}),
          o,
        );
        return { ok: r.ok, message: r.message };
      }
      case 'storage':
        return (await this.deps.storage.isHealthy())
          ? { ok: true, message: 'Storage answers.' }
          : { ok: false, message: 'Storage doesn’t answer.' };
      case 'antivirus':
        return (await clamavPing())
          ? { ok: true, message: 'ClamAV answers.' }
          : { ok: false, message: 'ClamAV doesn’t answer.' };
    }
  }

  /** Hosts typed in the dashboard are checked like URLs (no private networks unless allowed). */
  private async checkHost(host: string) {
    if (!host) throw new Error('Add the server’s address first.');
    await checkUrl(`https://${host}`, this.outboundOptions);
  }

  async deliveries() {
    const rows = await this.db
      .select()
      .from(schema.webhookDeliveries)
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(100);
    return {
      deliveries: rows.map((r) => ({
        id: r.id,
        event: r.event,
        status: r.status,
        ok: r.ok,
        attempt: r.attempt,
        at: r.createdAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------- for the rest of the app

  /** What clients need (in /v1/instance). Never a secret. */
  async publicInfo(): Promise<PublicIntegrations> {
    const [captcha, analytics, errors] = await Promise.all([
      this.store.get('captcha'),
      this.store.get('analytics'),
      this.store.get('errors'),
    ]);
    return {
      captcha:
        captcha.enabled && str(captcha.settings.siteKey)
          ? {
              provider: (str(captcha.settings.provider) || 'turnstile') as CaptchaProvider,
              siteKey: str(captcha.settings.siteKey),
            }
          : null,
      analytics:
        analytics.enabled && str(analytics.settings.url) && str(analytics.settings.siteId)
          ? {
              provider: (str(analytics.settings.provider) || 'plausible') as AnalyticsProvider,
              url: str(analytics.settings.url),
              siteId: str(analytics.settings.siteId),
            }
          : null,
      webErrors: errors.enabled && errors.settings.webErrors !== false,
    };
  }

  /** "off" when no CAPTCHA is configured; otherwise whether this answer is good. */
  async checkCaptcha(token: string | undefined, ip: string): Promise<'off' | boolean> {
    const cfg = await this.store.get('captcha');
    if (!cfg.enabled || !cfg.secrets.secretKey) return 'off';
    return verifyCaptcha(
      {
        provider: (str(cfg.settings.provider) || 'turnstile') as CaptchaProvider,
        secretKey: cfg.secrets.secretKey,
        token: token ?? '',
        ip,
      },
      this.outboundOptions,
    );
  }

  /** The text model to use now (tests' override, the environment, then the dashboard). */
  async aiModel(): Promise<TextModel | null> {
    if (this.deps.textModel !== undefined) return this.deps.textModel;
    const cfg = await this.store.get('ai');
    if (!cfg.enabled) return null;
    const s = cfg.settings;
    const url = str(s.url);
    if (cfg.source === 'dashboard') {
      // Checked once per configuration: a URL to a private network needs INTEGRATIONS_ALLOW_PRIVATE.
      await checkUrl(url, this.outboundOptions);
    }
    // Every call goes through the same checks as the test button (no redirects, no private
    // networks unless allowed), with the models' own longer time limit.
    // Addresses the server's own environment sets are trusted as before.
    const guarded =
      cfg.source === 'dashboard'
        ? (((input: URL | string | Request, init?: RequestInit) =>
            safeFetch(String(input instanceof Request ? input.url : input), init ?? {}, {
              ...this.outboundOptions,
              timeoutMs: 25_000,
            })) as typeof fetch)
        : (this.deps.fetch ?? fetch);
    return this.aiCache(JSON.stringify([s, cfg.secrets.apiKey ?? '']), () =>
      s.provider === 'openai'
        ? openAiCompatibleModel({
            baseUrl: url,
            model: str(s.model),
            apiKey: cfg.secrets.apiKey,
            external: s.external !== false,
            fetchImpl: guarded,
          })
        : ollamaModel(url, str(s.model), guarded),
    );
  }

  /** The video server to use now (tests' override, the environment, then the dashboard). */
  async media(): Promise<CallMedia | null> {
    if (this.deps.callMedia !== undefined) return this.deps.callMedia;
    const cfg = await this.store.get('video');
    if (!cfg.enabled) return null;
    const s = cfg.settings;
    return this.mediaCache(JSON.stringify([s, cfg.secrets.apiSecret ?? '']), () =>
      createLiveKitMedia({
        ...this.deps.env,
        LIVEKIT_URL: str(s.url),
        LIVEKIT_API_URL: str(s.apiUrl) || undefined,
        LIVEKIT_API_KEY: str(s.apiKey),
        LIVEKIT_API_SECRET: cfg.secrets.apiSecret,
      }),
    );
  }

  /** The mail transport to use now, and the sender, when the dashboard sets email. */
  async dashboardMail(): Promise<{ transport: Transporter; from: string } | null> {
    const cfg = await this.store.get('email');
    if (cfg.source !== 'dashboard' || !cfg.enabled) return null;
    await this.checkHost(str(cfg.settings.host));
    return { transport: this.transport(cfg), from: str(cfg.settings.from) };
  }

  private transport(cfg: ResolvedIntegration): Transporter {
    const s = cfg.settings;
    return this.mailCache(JSON.stringify([s, cfg.secrets.password ?? '']), () =>
      nodemailer.createTransport({
        host: str(s.host),
        port: Number(s.port) || 587,
        secure: s.secure === true,
        ...(str(s.user) ? { auth: { user: str(s.user), pass: cfg.secrets.password ?? '' } } : {}),
        connectionTimeout: 8000,
      }),
    );
  }

  /** Queues a webhook if one is set up for this event. Opaque ids only. */
  async emit(event: WebhookEvent, data: Record<string, string>): Promise<void> {
    if (!this.deps.outbound) return;
    const cfg = await this.store.get('webhooks');
    if (!cfg.enabled || !str(cfg.settings.events).split(',').includes(event)) return;
    const payload = webhookPayload(event, data, new Date(this.now()));
    await this.deps.outbound.webhook(payload).catch(() => undefined);
  }

  /** Queues a line for the team's chat if it asked for this event. Counts and links only. */
  async alert(event: AlertEvent, text: string): Promise<void> {
    if (!this.deps.outbound) return;
    const cfg = await this.store.get('alerts');
    if (!cfg.enabled || !str(cfg.settings.events).split(',').includes(event)) return;
    await this.deps.outbound.alert({ event, text }).catch(() => undefined);
  }

  /**
   * Reports an error to Sentry, if set up: at most 30 a minute, scrubbed of personal data, never
   * with request bodies, headers or user ids. Never throws.
   */
  async captureError(
    error: { type: string; message: string; stack?: string | undefined },
    platform: 'node' | 'javascript',
    tags: Record<string, string> = {},
  ): Promise<void> {
    try {
      const now = this.now();
      this.errorsSent = this.errorsSent.filter((t) => now - t < 60_000);
      if (this.errorsSent.length >= 30) return;
      const cfg = await this.store.get('errors');
      if (!cfg.enabled || !cfg.secrets.dsn || !parseDsn(cfg.secrets.dsn)) return;
      if (platform === 'javascript' && cfg.settings.webErrors === false) return;
      this.errorsSent.push(now);
      await reportError(
        cfg.secrets.dsn,
        error,
        {
          environment: str(cfg.settings.environment) || 'production',
          platform,
          tags: { app: platform === 'node' ? 'api' : 'web', ...tags },
        },
        this.outboundOptions,
      );
    } catch {
      // Monitoring must never break the app.
    }
  }

  /** The dashboard address, for links in alerts. */
  adminLink(path = ''): string {
    const base = (this.deps.env.PUBLIC_APP_URL ?? this.deps.env.CORS_ORIGINS[0] ?? '').replace(
      /\/+$/,
      '',
    );
    // The dashboard lives at admin.<domain> next to the app (see infra/web/Caddyfile).
    const admin = (
      this.deps.env.PUBLIC_ADMIN_URL ?? base.replace(/^(https?:\/\/)/, '$1admin.')
    ).replace(/\/+$/, '');
    return `${admin}/${path ? `#/${path}` : ''}`;
  }
}

/** The script each analytics provider serves (the manual-tracking variant where there is one). */
export function analyticsScript(cfg: Pick<ResolvedIntegration, 'settings'>): string {
  const url = str(cfg.settings.url).replace(/\/+$/, '');
  switch (cfg.settings.provider) {
    case 'umami':
      return `${url}/script.js`;
    case 'matomo':
      return `${url}/matomo.js`;
    default:
      return `${url}/js/script.manual.js`;
  }
}

/** ClamAV answers PING with PONG (the worker uses it to scan uploads). */
function clamavPing(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({
      host: process.env.CLAMAV_HOST || 'localhost',
      port: Number(process.env.CLAMAV_PORT || 3310),
    });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000, () => done(false));
    socket.on('error', () => done(false));
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (d) => done(d.toString().includes('PONG')));
  });
}
