// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Integrations (phase 24): every outside service the app can use, connected from the dashboard.
 * Environment variables on the server always win: an integration set there is shown as locked.
 * See docs/phases/PHASE-24.md.
 */
export const integrationIds = [
  'email',
  'google',
  'apple',
  'captcha',
  'ai',
  'video',
  'push',
  'errors',
  'analytics',
  'alerts',
  'webhooks',
  'storage',
  'antivirus',
] as const;
export type IntegrationId = (typeof integrationIds)[number];

export const integrationGroups = [
  'messaging',
  'signin',
  'security',
  'features',
  'operations',
  'infrastructure',
] as const;
export type IntegrationGroup = (typeof integrationGroups)[number];

export type FieldKind = 'text' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'multi';

export interface IntegrationField {
  key: string;
  kind: FieldKind;
  required?: boolean;
  /** For select and multi. */
  options?: readonly string[];
  /** Shown only when another field has one of these values (e.g. Telegram's chat id). */
  when?: { key: string; values: readonly string[] };
  min?: number;
  max?: number;
  default?: string | number | boolean;
}

export interface IntegrationDefinition {
  group: IntegrationGroup;
  fields: readonly IntegrationField[];
  /** Environment variables that, when set on the server, lock this integration. */
  envKeys: readonly string[];
  /** Changes apply after the API (and worker) restart. */
  restart?: boolean;
  /** Configured only on the server (shown with a health check). */
  serverOnly?: boolean;
  /** Members must agree before anything is sent (analytics, external AI). */
  needsConsent?: boolean;
}

export const emailPresets = ['custom', 'postmark', 'ses', 'mailgun', 'sendgrid', 'brevo'] as const;
/** SMTP hosts for the presets (the region of SES is chosen by the host). 📘 each provider's docs. */
export const EMAIL_PRESET_HOSTS: Record<
  Exclude<(typeof emailPresets)[number], 'custom'>,
  string
> = {
  postmark: 'smtp.postmarkapp.com',
  ses: 'email-smtp.eu-west-1.amazonaws.com',
  mailgun: 'smtp.mailgun.org',
  sendgrid: 'smtp.sendgrid.net',
  brevo: 'smtp-relay.brevo.com',
};

export const captchaProviders = ['turnstile', 'hcaptcha'] as const;
export type CaptchaProvider = (typeof captchaProviders)[number];
export const analyticsProviders = ['plausible', 'umami', 'matomo'] as const;
export type AnalyticsProvider = (typeof analyticsProviders)[number];
export const alertChannels = ['slack', 'discord', 'telegram', 'teams'] as const;
export type AlertChannel = (typeof alertChannels)[number];

/** What the team can be told about. Counts and links only: never names, messages or photos. */
export const alertEvents = [
  'report_urgent',
  'report_new',
  'waitlist_new',
  'daily_summary',
] as const;
export type AlertEvent = (typeof alertEvents)[number];

/** What webhooks can carry. Event type, time and opaque ids only. ⚖️ */
export const webhookEvents = [
  'member.joined',
  'member.deleted',
  'report.created',
  'report.resolved',
  'match.created',
  'event.created',
] as const;
export type WebhookEvent = (typeof webhookEvents)[number];

export const integrationCatalog: Record<IntegrationId, IntegrationDefinition> = {
  email: {
    group: 'messaging',
    envKeys: ['SMTP_HOST'],
    fields: [
      { key: 'preset', kind: 'select', options: emailPresets, default: 'custom' },
      { key: 'host', kind: 'text', required: true },
      { key: 'port', kind: 'number', min: 1, max: 65535, default: 587 },
      { key: 'secure', kind: 'boolean', default: false },
      { key: 'user', kind: 'text' },
      { key: 'password', kind: 'secret' },
      { key: 'from', kind: 'text', required: true },
    ],
  },
  google: {
    group: 'signin',
    envKeys: ['GOOGLE_CLIENT_ID'],
    restart: true,
    fields: [
      { key: 'clientId', kind: 'text', required: true },
      { key: 'clientSecret', kind: 'secret', required: true },
    ],
  },
  apple: {
    group: 'signin',
    envKeys: ['APPLE_CLIENT_ID'],
    restart: true,
    fields: [
      { key: 'clientId', kind: 'text', required: true },
      { key: 'clientSecret', kind: 'secret', required: true },
    ],
  },
  captcha: {
    group: 'security',
    envKeys: ['CAPTCHA_SECRET_KEY'],
    fields: [
      { key: 'provider', kind: 'select', options: captchaProviders, default: 'turnstile' },
      { key: 'siteKey', kind: 'text', required: true },
      { key: 'secretKey', kind: 'secret', required: true },
    ],
  },
  ai: {
    group: 'features',
    envKeys: ['ICEBREAKERS_PROVIDER'],
    fields: [
      { key: 'provider', kind: 'select', options: ['ollama', 'openai'], default: 'ollama' },
      { key: 'url', kind: 'url', required: true },
      { key: 'model', kind: 'text', required: true },
      { key: 'apiKey', kind: 'secret', when: { key: 'provider', values: ['openai'] } },
      {
        key: 'external',
        kind: 'boolean',
        default: true,
        when: { key: 'provider', values: ['openai'] },
      },
    ],
  },
  video: {
    group: 'features',
    envKeys: ['LIVEKIT_URL'],
    fields: [
      { key: 'url', kind: 'url', required: true },
      { key: 'apiUrl', kind: 'url' },
      { key: 'apiKey', kind: 'text', required: true },
      { key: 'apiSecret', kind: 'secret', required: true },
    ],
  },
  push: {
    group: 'messaging',
    envKeys: ['PUSH_PROVIDER', 'EXPO_ACCESS_TOKEN'],
    fields: [{ key: 'accessToken', kind: 'secret' }],
  },
  errors: {
    group: 'operations',
    envKeys: ['SENTRY_DSN'],
    fields: [
      { key: 'dsn', kind: 'secret', required: true },
      { key: 'environment', kind: 'text', default: 'production' },
      { key: 'webErrors', kind: 'boolean', default: true },
    ],
  },
  analytics: {
    group: 'operations',
    envKeys: ['ANALYTICS_PROVIDER'],
    needsConsent: true,
    fields: [
      { key: 'provider', kind: 'select', options: analyticsProviders, default: 'plausible' },
      { key: 'url', kind: 'url', required: true },
      { key: 'siteId', kind: 'text', required: true },
    ],
  },
  alerts: {
    group: 'operations',
    envKeys: [],
    fields: [
      { key: 'channel', kind: 'select', options: alertChannels, default: 'slack' },
      {
        key: 'webhookUrl',
        kind: 'secret',
        when: { key: 'channel', values: ['slack', 'discord', 'teams'] },
      },
      { key: 'botToken', kind: 'secret', when: { key: 'channel', values: ['telegram'] } },
      { key: 'chatId', kind: 'text', when: { key: 'channel', values: ['telegram'] } },
      { key: 'events', kind: 'multi', options: alertEvents, default: 'report_urgent,waitlist_new' },
    ],
  },
  webhooks: {
    group: 'operations',
    envKeys: [],
    fields: [
      { key: 'url', kind: 'url', required: true },
      { key: 'signingSecret', kind: 'secret', required: true },
      {
        key: 'events',
        kind: 'multi',
        options: webhookEvents,
        default: 'member.joined,report.created',
      },
    ],
  },
  storage: { group: 'infrastructure', envKeys: ['S3_ENDPOINT'], serverOnly: true, fields: [] },
  antivirus: { group: 'infrastructure', envKeys: ['CLAMAV_HOST'], serverOnly: true, fields: [] },
};

/** Where an integration's settings come from. */
export const integrationSources = ['none', 'dashboard', 'env'] as const;
export type IntegrationSource = (typeof integrationSources)[number];

const settingValue = z.union([z.string().max(2000), z.number(), z.boolean()]);

export const integrationViewSchema = z.object({
  id: z.enum(integrationIds),
  group: z.enum(integrationGroups),
  source: z.enum(integrationSources),
  enabled: z.boolean(),
  /** Settings that aren't secret (never secrets: see `secretsSet`). */
  settings: z.record(z.string(), settingValue),
  /** Which secrets are stored (their values never leave the server). */
  secretsSet: z.array(z.string()),
  lastTest: z.object({ ok: z.boolean(), message: z.string(), at: z.string() }).nullable(),
  restart: z.boolean(),
  serverOnly: z.boolean(),
  /** Hosts the web app's Content-Security-Policy must allow for this integration. */
  cspHosts: z.array(z.string()),
});
export type IntegrationView = z.infer<typeof integrationViewSchema>;

export const integrationsResponseSchema = z.object({
  integrations: z.array(integrationViewSchema),
  /** False when INTEGRATIONS_KEY isn't set: the page is read-only. */
  editable: z.boolean(),
});

export const integrationUpdateSchema = z
  .object({
    enabled: z.boolean(),
    settings: z.record(z.string(), settingValue).default({}),
    /** A value sets the secret, null removes it, a missing key leaves it as it is. */
    secrets: z.record(z.string(), z.string().min(1).max(4000).nullable()).default({}),
  })
  .strict();
export type IntegrationUpdate = z.input<typeof integrationUpdateSchema>;

export const integrationTestSchema = z.object({ ok: z.boolean(), message: z.string() });

export const webhookDeliverySchema = z.object({
  id: z.string(),
  event: z.string(),
  status: z.number().int().nullable(),
  ok: z.boolean(),
  attempt: z.number().int(),
  at: z.string(),
});
export const webhookDeliveriesSchema = z.object({ deliveries: z.array(webhookDeliverySchema) });

/** What clients learn about integrations (in /v1/instance): only what they need to run. */
export const publicIntegrationsSchema = z.object({
  captcha: z.object({ provider: z.enum(captchaProviders), siteKey: z.string() }).nullable(),
  analytics: z
    .object({ provider: z.enum(analyticsProviders), url: z.string(), siteId: z.string() })
    .nullable(),
  /** Whether the web app may report its errors (to this server, which forwards them). */
  webErrors: z.boolean(),
});
export type PublicIntegrations = z.infer<typeof publicIntegrationsSchema>;

/** The header clients send the CAPTCHA answer in. */
export const CAPTCHA_HEADER = 'x-captcha-token';

/** A browser error reported by the web app: no URLs with ids, no user data. */
export const clientErrorSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    stack: z.string().max(4000).optional(),
    /** The route pattern, e.g. /profile/[id] (never the real id). */
    route: z.string().max(200).optional(),
  })
  .strict();

/**
 * A route with its ids replaced, for analytics and error reports: /profile/3f2a… → /profile/[id].
 * Anything that looks like an id, a token or a number becomes a placeholder.
 */
export function routePattern(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? '/';
  return (
    clean
      .split('/')
      .map((part) =>
        /^[0-9a-f-]{16,}$/i.test(part) || /^[A-Za-z0-9_-]{20,}$/.test(part) || /^\d+$/.test(part)
          ? '[id]'
          : part,
      )
      .join('/') || '/'
  );
}
