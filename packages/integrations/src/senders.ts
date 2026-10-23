// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHmac, randomUUID } from 'node:crypto';
import type { AlertChannel, CaptchaProvider, WebhookEvent } from '@nexaheart/shared';
import { type OutboundOptions, safeFetch } from './safe-fetch.js';

// ------------------------------------------------------------------ CAPTCHA

/** 📘 https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ */
const VERIFY_URL: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
};

/**
 * Checks a CAPTCHA answer with its provider. The visitor's IP goes with it, as both providers
 * expect. Any failure (network, a bad answer) means "not verified".
 */
export async function verifyCaptcha(
  input: { provider: CaptchaProvider; secretKey: string; token: string; ip?: string | undefined },
  options: OutboundOptions = {},
): Promise<boolean> {
  if (!input.token || input.token.length > 4096) return false;
  const body = new URLSearchParams({ secret: input.secretKey, response: input.token });
  if (input.ip) body.set('remoteip', input.ip);
  try {
    const res = await safeFetch(
      VERIFY_URL[input.provider],
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
      { ...options, allowPrivate: false },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ team alerts

export interface AlertTarget {
  channel: AlertChannel;
  webhookUrl?: string | undefined;
  botToken?: string | undefined;
  chatId?: string | undefined;
}

/** The chat to alert, from the integration's settings. */
export function alertTargetFrom(cfg: {
  settings: Record<string, string | number | boolean>;
  secrets: Record<string, string>;
}): AlertTarget {
  const channel = String(cfg.settings.channel || 'slack') as AlertChannel;
  return {
    channel,
    webhookUrl: cfg.secrets.webhookUrl,
    botToken: cfg.secrets.botToken,
    chatId: typeof cfg.settings.chatId === 'string' ? cfg.settings.chatId : undefined,
  };
}

/**
 * Sends one short line to the team's chat. The text is built by the app from counts and a link to
 * the dashboard; it never carries names, messages or photos.
 */
export async function sendAlert(
  target: AlertTarget,
  text: string,
  options: OutboundOptions = {},
): Promise<{ ok: boolean; status: number | null; message: string }> {
  let url: string;
  let payload: unknown;
  switch (target.channel) {
    case 'slack':
    case 'teams':
      // 📘 Slack incoming webhooks; Teams "Workflows" webhooks accept the same simple text.
      url = target.webhookUrl ?? '';
      payload = { text };
      break;
    case 'discord':
      url = target.webhookUrl ?? '';
      // No @everyone or role pings, ever.
      payload = { content: text, allowed_mentions: { parse: [] } };
      break;
    case 'telegram':
      if (!target.botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(target.botToken)) {
        return { ok: false, status: null, message: 'The bot token doesn’t look right.' };
      }
      url = `https://api.telegram.org/bot${target.botToken}/sendMessage`;
      payload = { chat_id: target.chatId, text, disable_web_page_preview: true };
      break;
  }
  if (!url) return { ok: false, status: null, message: 'Add the webhook address first.' };
  try {
    const res = await safeFetch(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { ...options, allowPrivate: false },
    );
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? 'Delivered.' : `The service answered ${res.status}.`,
    };
  } catch (error) {
    return { ok: false, status: null, message: (error as Error).message || 'Couldn’t reach it.' };
  }
}

// ------------------------------------------------------------------ webhooks

export interface WebhookPayload {
  id: string;
  type: WebhookEvent | 'test';
  occurredAt: string;
  /** Opaque ids only. */
  data: Record<string, string>;
}

export function webhookPayload(
  type: WebhookPayload['type'],
  data: Record<string, string>,
  at = new Date(),
): WebhookPayload {
  return { id: randomUUID(), type, occurredAt: at.toISOString(), data };
}

/**
 * Like Stripe's: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. Receivers check it and
 * refuse old timestamps (replay).
 */
export function signWebhook(secret: string, body: string, unixSeconds: number): string {
  const mac = createHmac('sha256', secret).update(`${unixSeconds}.${body}`).digest('hex');
  return `t=${unixSeconds},v1=${mac}`;
}

export async function deliverWebhook(
  target: { url: string; signingSecret: string },
  payload: WebhookPayload,
  options: OutboundOptions & { nowSeconds?: number } = {},
): Promise<{ ok: boolean; status: number | null; message: string }> {
  const body = JSON.stringify(payload);
  const t = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  try {
    const res = await safeFetch(
      target.url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'NexaHeart-Webhooks/1',
          'x-nexaheart-event': payload.type,
          'x-nexaheart-signature': signWebhook(target.signingSecret, body, t),
        },
        body,
      },
      options,
    );
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? 'Delivered.' : `The receiver answered ${res.status}.`,
    };
  } catch (error) {
    return { ok: false, status: null, message: (error as Error).message || 'Couldn’t reach it.' };
  }
}

// ------------------------------------------------------------------ error monitoring

export interface SentryDsn {
  endpoint: string;
  publicKey: string;
}

/** https://<key>@<host>/<project> → the envelope endpoint. 📘 develop.sentry.dev/sdk/envelopes */
export function parseDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!url.username || !/^\d+$/.test(project.split('/').pop() ?? '')) return null;
    const prefix = project.split('/').slice(0, -1).join('/');
    const id = project.split('/').pop();
    return {
      endpoint: `${url.protocol}//${url.host}/${prefix ? `${prefix}/` : ''}api/${id}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const LONG_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;
const QUERY = /\?[^\s)]*/g;

/** Removes what could identify someone from an error text: emails, ids, tokens, query strings. */
export function scrub(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(LONG_ID, '[id]')
    .replace(TOKEN, '[token]')
    .replace(QUERY, '?[…]');
}

function frames(stack: string | undefined) {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1, 40)
    .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      function: m[1] ?? '?',
      // Only the path inside the app: no home directories.
      filename: scrub(m[2]!.replace(/^.*?\/(apps|packages|node_modules)\//, '$1/')),
      lineno: Number(m[3]),
      colno: Number(m[4]),
    }))
    .reverse();
}

/**
 * Sends one error to Sentry (or GlitchTip) as an envelope. No request bodies, cookies, headers,
 * user ids or IP addresses are ever included; the message and stack are scrubbed.
 */
export async function reportError(
  dsn: string,
  error: { type: string; message: string; stack?: string | undefined },
  context: {
    environment: string;
    release?: string;
    platform: 'node' | 'javascript';
    tags?: Record<string, string>;
  },
  options: OutboundOptions = {},
): Promise<{ ok: boolean; status: number | null; message: string }> {
  const parsed = parseDsn(dsn);
  if (!parsed) return { ok: false, status: null, message: 'The DSN doesn’t look right.' };
  const eventId = randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: context.platform,
    level: 'error',
    environment: context.environment,
    ...(context.release ? { release: context.release } : {}),
    tags: context.tags ?? {},
    exception: {
      values: [
        {
          type: error.type.slice(0, 100),
          value: scrub(error.message).slice(0, 1000),
          stacktrace: { frames: frames(error.stack) },
        },
      ],
    },
  };
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  try {
    const res = await safeFetch(
      parsed.endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-sentry-envelope',
          'x-sentry-auth': `Sentry sentry_version=7, sentry_client=nexaheart/1.0, sentry_key=${parsed.publicKey}`,
        },
        body,
      },
      options,
    );
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? 'Sent.' : `The server answered ${res.status}.`,
    };
  } catch (e) {
    return { ok: false, status: null, message: (e as Error).message || 'Couldn’t reach it.' };
  }
}
