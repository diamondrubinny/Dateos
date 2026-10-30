// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Locale, WebPushConfig } from '@nexaheart/shared';
import { apiFetch, json } from './api';

/** Phase 60: notifications in the web app (Web Push). Web only; see lib/push.ts. */
export type WebPushResult = 'enabled' | 'denied' | 'unsupported' | 'not-configured' | 'home-screen';

/** An iPhone or iPad browser that isn't the app on the home screen: no Web Push there. 📘 */
function iosOutsideHomeScreen(): boolean {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !standalone;
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The service worker the build registers (phase 57); none in development. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
}

const keyBytes = (base64url: string) => {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * Asks the browser (from the member's own tap), subscribes with this server's key and sends the
 * subscription to this server only. The browser vendor's push service delivers what the server
 * encrypted to this browser; it can't read it.
 */
export async function enableWebPush(locale: Locale): Promise<WebPushResult> {
  if (!supported()) return iosOutsideHomeScreen() ? 'home-screen' : 'unsupported';
  const config = await apiFetch<WebPushConfig>('/v1/push/web');
  if (!config.enabled || !config.publicKey) return 'not-configured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(config.publicKey),
    }));
  const { endpoint, keys } = subscription.toJSON();
  await apiFetch('/v1/me/web-push', {
    method: 'POST',
    // Only what the server needs: not the browser's other fields.
    body: json({ endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth }, locale }),
  });
  return 'enabled';
}

/** Turning it off, and before signing out: this browser stops getting this account's notifications. */
export async function disableWebPush(): Promise<void> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await apiFetch('/v1/me/web-push', {
    method: 'DELETE',
    body: json({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

export async function webPushEnabled(): Promise<boolean> {
  if (!supported() || Notification.permission !== 'granted') return false;
  const reg = await registration();
  return Boolean(await reg?.pushManager.getSubscription());
}
