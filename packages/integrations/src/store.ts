// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  integrationCatalog,
  type IntegrationId,
  integrationIds,
  type IntegrationSource,
  type IntegrationUpdate,
  type IntegrationView,
} from '@nexaheart/shared';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from './crypto.js';

const { integrations } = schema;

export type SettingValue = string | number | boolean;
type RawEnv = Record<string, string | undefined>;

/** An integration as the app uses it: settings and secrets together, from env or the dashboard. */
export interface ResolvedIntegration {
  id: IntegrationId;
  source: IntegrationSource;
  enabled: boolean;
  settings: Record<string, SettingValue>;
  secrets: Record<string, string>;
}

export class IntegrationInputError extends Error {}

const present = (v: string | undefined) => v !== undefined && v.trim() !== '';

/** Whether the server's environment sets this integration (env always wins). */
export function setByEnv(id: IntegrationId, env: RawEnv): boolean {
  return integrationCatalog[id].envKeys.some((k) => present(env[k]));
}

/**
 * The integration as the environment describes it. Only called when `setByEnv` is true; the
 * apps keep reading their own env for anything else they need.
 */
export function fromEnv(id: IntegrationId, env: RawEnv): ResolvedIntegration {
  const s = (k: string) => env[k]?.trim() ?? '';
  const base = { id, source: 'env' as const, enabled: true };
  switch (id) {
    case 'email':
      return {
        ...base,
        settings: {
          preset: 'custom',
          host: s('SMTP_HOST'),
          port: Number(s('SMTP_PORT') || 587),
          secure: s('SMTP_SECURE') === 'true',
          user: s('SMTP_USER'),
          from: s('SMTP_FROM'),
        },
        secrets: present(env.SMTP_PASSWORD) ? { password: s('SMTP_PASSWORD') } : {},
      };
    case 'google':
    case 'apple': {
      const p = id.toUpperCase();
      return {
        ...base,
        settings: { clientId: s(`${p}_CLIENT_ID`) },
        secrets: { clientSecret: s(`${p}_CLIENT_SECRET`) },
      };
    }
    case 'captcha':
      return {
        ...base,
        settings: {
          provider: s('CAPTCHA_PROVIDER') || 'turnstile',
          siteKey: s('CAPTCHA_SITE_KEY'),
        },
        secrets: { secretKey: s('CAPTCHA_SECRET_KEY') },
      };
    case 'ai': {
      const provider = s('ICEBREAKERS_PROVIDER');
      return {
        ...base,
        enabled: provider === 'ollama' || provider === 'openai',
        settings:
          provider === 'openai'
            ? {
                provider,
                url: s('OPENAI_BASE_URL'),
                model: s('OPENAI_MODEL'),
                external: s('OPENAI_EXTERNAL') !== 'false',
              }
            : {
                provider: 'ollama',
                url: s('OLLAMA_URL') || 'http://localhost:11434',
                model: s('OLLAMA_CHAT_MODEL') || 'qwen2.5:1.5b',
              },
        secrets: present(env.OPENAI_API_KEY) ? { apiKey: s('OPENAI_API_KEY') } : {},
      };
    }
    case 'video':
      return {
        ...base,
        settings: {
          url: s('LIVEKIT_URL'),
          apiUrl: s('LIVEKIT_API_URL'),
          apiKey: s('LIVEKIT_API_KEY'),
        },
        secrets: { apiSecret: s('LIVEKIT_API_SECRET') },
      };
    case 'push':
      return {
        ...base,
        // PUSH_PROVIDER=disabled turns notifications off from the server.
        enabled: s('PUSH_PROVIDER') !== 'disabled',
        settings: {},
        secrets: present(env.EXPO_ACCESS_TOKEN) ? { accessToken: s('EXPO_ACCESS_TOKEN') } : {},
      };
    case 'errors':
      return {
        ...base,
        settings: {
          environment: s('SENTRY_ENVIRONMENT') || 'production',
          webErrors: s('SENTRY_WEB_ERRORS') !== 'false',
        },
        secrets: { dsn: s('SENTRY_DSN') },
      };
    case 'analytics':
      return {
        ...base,
        settings: {
          provider: s('ANALYTICS_PROVIDER'),
          url: s('ANALYTICS_URL'),
          siteId: s('ANALYTICS_SITE_ID'),
        },
        secrets: {},
      };
    default:
      return { ...base, settings: {}, secrets: {} };
  }
}

/** Checks settings and secrets against the catalog; returns them normalised. */
export function validateUpdate(
  id: IntegrationId,
  update: {
    enabled: boolean;
    settings: Record<string, SettingValue>;
    secrets: Record<string, string | null>;
  },
  existingSecrets: string[],
): { settings: Record<string, SettingValue>; secrets: Record<string, string | null> } {
  const def = integrationCatalog[id];
  if (def.serverOnly) throw new IntegrationInputError('This is set on the server only.');
  const fields = new Map(def.fields.map((f) => [f.key, f]));
  const settings: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(update.settings)) {
    const field = fields.get(key);
    if (!field || field.kind === 'secret')
      throw new IntegrationInputError(`Unknown setting: ${key}`);
    switch (field.kind) {
      case 'number': {
        const n = Number(value);
        if (
          !Number.isInteger(n) ||
          (field.min !== undefined && n < field.min) ||
          (field.max !== undefined && n > field.max)
        ) {
          throw new IntegrationInputError(`${key} must be a whole number in range.`);
        }
        settings[key] = n;
        break;
      }
      case 'boolean':
        if (typeof value !== 'boolean')
          throw new IntegrationInputError(`${key} must be true or false.`);
        settings[key] = value;
        break;
      case 'select':
        if (typeof value !== 'string' || !field.options?.includes(value)) {
          throw new IntegrationInputError(`${key} has an unknown value.`);
        }
        settings[key] = value;
        break;
      case 'multi': {
        const list = String(value)
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        if (list.some((v) => !field.options?.includes(v))) {
          throw new IntegrationInputError(`${key} has an unknown value.`);
        }
        settings[key] = [...new Set(list)].join(',');
        break;
      }
      case 'url': {
        const text = String(value).trim();
        if (text) {
          let url: URL;
          try {
            url = new URL(text);
          } catch {
            throw new IntegrationInputError(`${key} must be an address.`);
          }
          if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
            throw new IntegrationInputError(
              `${key} must be an http(s) address without a password.`,
            );
          }
        }
        settings[key] = text.replace(/\/+$/, '');
        break;
      }
      default: {
        const text = String(value).trim();
        // eslint-disable-next-line no-control-regex -- matching control characters is the point
        if (/[\u0000-\u001f]/.test(text))
          throw new IntegrationInputError(`${key} must be one line.`);
        settings[key] = text;
      }
    }
  }
  const secrets: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(update.secrets)) {
    if (fields.get(key)?.kind !== 'secret')
      throw new IntegrationInputError(`Unknown secret: ${key}`);
    secrets[key] = value === null ? null : value.trim();
  }
  if (update.enabled) {
    const visible = (f: (typeof def.fields)[number]) =>
      !f.when || f.when.values.includes(String(settings[f.when.key] ?? f.default ?? ''));
    for (const f of def.fields) {
      if (!f.required || !visible(f)) continue;
      const has =
        f.kind === 'secret'
          ? secrets[f.key] !== undefined
            ? secrets[f.key] !== null
            : existingSecrets.includes(f.key)
          : settings[f.key] !== undefined && settings[f.key] !== '';
      if (!has) throw new IntegrationInputError(`${f.key} is required.`);
    }
  }
  return { settings, secrets };
}

/** Hosts the web app's CSP must allow, from the settings (CAPTCHA and analytics load scripts). */
export function cspHostsFor(id: IntegrationId, settings: Record<string, SettingValue>): string[] {
  if (id === 'captcha') {
    return settings.provider === 'hcaptcha'
      ? ['https://hcaptcha.com', 'https://*.hcaptcha.com']
      : ['https://challenges.cloudflare.com'];
  }
  if (id === 'analytics' && typeof settings.url === 'string' && settings.url) {
    try {
      return [new URL(settings.url).origin];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Integrations as stored in the database, merged with the server's environment (which wins).
 * Reads are cached for a few seconds and refreshed on every save, so changes apply without a
 * restart.
 */
export class IntegrationStore {
  private cache: { at: number; rows: Map<string, typeof integrations.$inferSelect> } | null = null;

  constructor(
    private readonly db: Database,
    private readonly key: Buffer | null,
    private readonly env: RawEnv = process.env,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get editable(): boolean {
    return this.key !== null;
  }

  invalidate(): void {
    this.cache = null;
  }

  private async rows() {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.rows;
    const rows = await this.db.select().from(integrations);
    this.cache = { at: this.now(), rows: new Map(rows.map((r) => [r.id, r])) };
    return this.cache.rows;
  }

  private open(id: string, sealed: Record<string, string>): Record<string, string> {
    if (!this.key) return {};
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(sealed)) {
      const plain = decryptSecret(this.key, `${id}.${name}`, value);
      if (plain !== null) out[name] = plain;
    }
    return out;
  }

  /** The integration to use now. Disabled (or unset) integrations come back with enabled false. */
  async get(id: IntegrationId): Promise<ResolvedIntegration> {
    if (setByEnv(id, this.env)) return fromEnv(id, this.env);
    const row = (await this.rows()).get(id);
    if (!row) return { id, source: 'none', enabled: false, settings: {}, secrets: {} };
    const defaults = Object.fromEntries(
      integrationCatalog[id].fields
        .filter((f) => f.default !== undefined && f.kind !== 'secret')
        .map((f) => [f.key, f.default!]),
    );
    return {
      id,
      source: 'dashboard',
      // Without the key, secrets can't be read: an integration that needs them can't run.
      enabled: row.enabled && (this.key !== null || Object.keys(row.secrets).length === 0),
      settings: { ...defaults, ...row.settings },
      secrets: this.open(id, row.secrets),
    };
  }

  /** What the dashboard shows: never a secret's value. */
  async list(): Promise<IntegrationView[]> {
    const rows = await this.rows();
    const views: IntegrationView[] = [];
    for (const id of integrationIds) {
      const def = integrationCatalog[id];
      const resolved = await this.get(id);
      const row = rows.get(id);
      const env = resolved.source === 'env';
      views.push({
        id,
        group: def.group,
        source: resolved.source,
        enabled: resolved.enabled,
        settings: resolved.settings,
        secretsSet: env
          ? Object.entries(resolved.secrets)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : Object.keys(row?.secrets ?? {}),
        lastTest:
          row?.lastTestAt && row.lastTestOk !== null
            ? {
                ok: row.lastTestOk,
                message: row.lastTestMessage ?? '',
                at: row.lastTestAt.toISOString(),
              }
            : null,
        restart: def.restart ?? false,
        serverOnly: def.serverOnly ?? false,
        cspHosts: resolved.enabled ? cspHostsFor(id, resolved.settings) : [],
      });
    }
    return views;
  }

  /** Saves the dashboard's settings. Returns the names of the fields that changed (for the audit). */
  async save(id: IntegrationId, update: IntegrationUpdate, actorId: string): Promise<string[]> {
    if (setByEnv(id, this.env)) {
      throw new IntegrationInputError(
        'This integration is set on the server and can’t be changed here.',
      );
    }
    if (!this.key) throw new IntegrationInputError('Set INTEGRATIONS_KEY on the server first.');
    const [current] = await this.db.select().from(integrations).where(eq(integrations.id, id));
    const full = {
      enabled: update.enabled,
      settings: update.settings ?? {},
      secrets: update.secrets ?? {},
    };
    const { settings, secrets } = validateUpdate(id, full, Object.keys(current?.secrets ?? {}));
    const sealed: Record<string, string> = { ...(current?.secrets ?? {}) };
    for (const [name, value] of Object.entries(secrets)) {
      if (value === null) delete sealed[name];
      else sealed[name] = encryptSecret(this.key, `${id}.${name}`, value);
    }
    const values = {
      enabled: update.enabled,
      settings,
      secrets: sealed,
      updatedBy: actorId,
      updatedAt: new Date(this.now()),
      // A new configuration hasn't been tested yet.
      lastTestOk: null,
      lastTestMessage: null,
      lastTestAt: null,
    };
    await this.db
      .insert(integrations)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: integrations.id, set: values });
    this.invalidate();
    const changed = new Set<string>(['enabled']);
    for (const k of Object.keys(settings)) {
      if (current?.settings[k] !== settings[k]) changed.add(k);
    }
    for (const k of Object.keys(secrets)) changed.add(k);
    return [...changed].sort();
  }

  async remove(id: IntegrationId): Promise<void> {
    await this.db.delete(integrations).where(eq(integrations.id, id));
    this.invalidate();
  }

  async recordTest(id: IntegrationId, ok: boolean, message: string): Promise<void> {
    const values = {
      lastTestOk: ok,
      lastTestMessage: message.slice(0, 300),
      lastTestAt: new Date(this.now()),
    };
    await this.db
      .insert(integrations)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: integrations.id, set: values });
    this.invalidate();
  }
}
