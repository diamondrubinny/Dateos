// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { webPushSubject } from '../src/env.js';

const script = fileURLToPath(new URL('../../../scripts/web-push-keys.sh', import.meta.url));
const keysFromInstall = () => {
  const out = execFileSync('bash', [script], { encoding: 'utf8' });
  const get = (name: string) => new RegExp(`^${name}=(.+)$`, 'm').exec(out)![1]!;
  return { publicKey: get('WEB_PUSH_PUBLIC_KEY'), privateKey: get('WEB_PUSH_PRIVATE_KEY') };
};

describe('notifications in the web app: keys and sending (phase 60)', () => {
  it('the install command makes a real key pair: the private key gives exactly the public one', () => {
    const { publicKey, privateKey } = keysFromInstall();
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    expect(ecdh.getPublicKey().toString('base64url')).toBe(publicKey);
    // Two runs, two different pairs.
    expect(keysFromInstall().privateKey).not.toBe(privateKey);
  });

  it('web-push accepts them and makes a signed, encrypted request for a browser', () => {
    const vapid = keysFromInstall();
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const request = webpush.generateRequestDetails(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test',
        keys: {
          p256dh: browser.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      },
      JSON.stringify({ title: 'Ahava', body: 'You have a new message', kind: 'message', id: 'x' }),
      {
        vapidDetails: { subject: 'https://ahava.example.org', ...vapid },
        TTL: 60,
        urgency: 'high',
      },
    );
    expect(request.endpoint).toBe('https://fcm.googleapis.com/fcm/send/test');
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(request.headers.Authorization)).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`),
    );
    // Encrypted: the text isn't readable on the way.
    expect(Buffer.from(request.body as Buffer).toString('latin1')).not.toContain('new message');
  });

  it('the sender address push services ask for', () => {
    const base = { WEB_PUSH_SUBJECT: '', PUBLIC_APP_URL: '', CORS_ORIGINS: '', SMTP_FROM: '' };
    expect(
      webPushSubject({
        ...base,
        CORS_ORIGINS: 'https://ahava.example.org,https://admin.ahava.example.org',
      }),
    ).toBe('https://ahava.example.org');
    expect(webPushSubject({ ...base, WEB_PUSH_SUBJECT: 'mailto:team@ahava.example.org' })).toBe(
      'mailto:team@ahava.example.org',
    );
    // Development (http): the mail sender instead.
    expect(
      webPushSubject({
        ...base,
        CORS_ORIGINS: 'http://localhost:8081',
        SMTP_FROM: 'NexaHeart <no-reply@localhost>',
      }),
    ).toBe('mailto:no-reply@localhost');
  });
});
