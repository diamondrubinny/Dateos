// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { localeSchema } from './common.js';

/**
 * Phase 60: the push services browsers use. A subscription's address is chosen by the member's
 * browser, and the worker POSTs to it: only these hosts are accepted, so the server can't be made
 * to call anything else. 📘 Each browser vendor's documentation; extend when a new one appears.
 */
export const WEB_PUSH_HOSTS = {
  /** Exact hosts. */
  exact: ['fcm.googleapis.com', 'web.push.apple.com'],
  /** Any host ending with one of these (Mozilla and Microsoft use several). */
  suffix: ['.push.services.mozilla.com', '.notify.windows.com'],
} as const;

/** Most browsers a person uses at once; older subscriptions beyond it are dropped. */
export const WEB_PUSH_MAX_PER_ACCOUNT = 10;

/** Whether `endpoint` is an HTTPS address at a known browser push service. */
export function isWebPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return (
    (WEB_PUSH_HOSTS.exact as readonly string[]).includes(host) ||
    WEB_PUSH_HOSTS.suffix.some((s) => host.endsWith(s) && host.length > s.length)
  );
}

/** Base64url without padding, as browsers give the keys. */
const base64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

/** What `PushSubscription.toJSON()` gives, plus the language of the (content-free) text. */
export const webPushSubscriptionSchema = z
  .object({
    endpoint: z.string().max(1000).refine(isWebPushEndpoint, 'Not a known browser push service.'),
    keys: z
      .object({
        // An uncompressed P-256 public key (65 bytes) and a 16-byte secret, base64url.
        p256dh: base64url(86, 88),
        auth: base64url(22, 24),
      })
      .strict(),
    locale: localeSchema.default('en'),
  })
  .strict();
export type WebPushSubscriptionInput = z.infer<typeof webPushSubscriptionSchema>;

/** `GET /v1/push/web`: whether this server sends web notifications, and its public key. */
export const webPushConfigSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
});
export type WebPushConfig = z.infer<typeof webPushConfigSchema>;

/**
 * The payload the service worker shows (encrypted to the browser, RFC 8291): the community's
 * name, a generic sentence, and an opaque id to open the right screen. Never a name or text.
 */
export interface WebPushPayload {
  title: string;
  body: string;
  kind: string;
  id: string;
  /**
   * Phase 72: chats with unread messages, for the number on the app's icon; absent when the
   * member turned it off or uses discreet notifications.
   */
  badge?: number;
  /** Phase 72: a button on the notification (the check-in's "I'm OK"). */
  actions?: { action: string; title: string }[];
  /**
   * Phase 72: the same notification in the declarative form (📘 WebKit's Declarative Web Push),
   * shown by browsers that support it even when the service worker isn't running.
   */
  web_push?: 8030;
  notification?: {
    title: string;
    body: string;
    navigate: string;
    lang: string;
    app_badge?: string;
    actions?: { action: string; title: string; navigate: string }[];
  };
}

/** Phase 72: the screen a notification opens (the service worker has the same mapping). */
export function pushScreen(kind: string, id: string): string {
  const uuid = /^[0-9a-f-]{36}$/.test(id) ? id : null;
  switch (kind) {
    case 'message':
    case 'match':
    case 'call':
      return uuid ? `/chat/${uuid}` : '/matches';
    case 'after_rest':
      return '/matches';
    case 'partner_message':
      return uuid ? `/partner-chat/${uuid}` : '/matches';
    case 'checkin':
      return '/checkin';
    case 'event':
      return uuid ? `/events/${uuid}` : '/';
    case 'visible':
      return '/profile';
    default:
      return '/';
  }
}
