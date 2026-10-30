// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { isWebPushEndpoint, webPushSubscriptionSchema } from '../src/web-push.js';

const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

describe('web push subscriptions (phase 60)', () => {
  it('accepts the browsers’ push services', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://web.push.apple.com/QGuQyavXutnMH8',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
    ]) {
      expect(isWebPushEndpoint(ok), ok).toBe(true);
    }
  });

  it('refuses anything the server could be made to call instead', () => {
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x', // not HTTPS
      'https://fcm.googleapis.com:8443/x', // another port
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x', // look-alike
      'https://evilpush.services.mozilla.com.example/x',
      'https://push.services.mozilla.com/x', // the bare suffix isn't a host
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isWebPushEndpoint(bad), bad).toBe(false);
    }
  });

  it('takes what PushSubscription.toJSON() gives, strictly', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    expect(webPushSubscriptionSchema.safeParse({ endpoint, keys }).success).toBe(true);
    expect(webPushSubscriptionSchema.parse({ endpoint, keys }).locale).toBe('en');
    expect(
      webPushSubscriptionSchema.safeParse({ endpoint, keys: { ...keys, auth: 'a+b/' } }).success,
    ).toBe(false);
    expect(
      webPushSubscriptionSchema.safeParse({ endpoint, keys, expirationTime: null }).success,
    ).toBe(false);
    expect(
      webPushSubscriptionSchema.safeParse({ endpoint: 'https://example.org/x', keys }).success,
    ).toBe(false);
  });
});
