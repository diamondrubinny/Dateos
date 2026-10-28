// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildLoggerOptions, logUrl } from '../src/lib/logger.js';

describe('request logs', () => {
  it('keep the path only', () => {
    expect(logUrl('/v1/auth/magic-link/verify?token=secret-token')).toBe(
      '/v1/auth/magic-link/verify',
    );
    expect(logUrl('/v1/matches/abc/messages/search?q=my+address')).toBe(
      '/v1/matches/abc/messages/search',
    );
    expect(logUrl(undefined)).toBe('');
  });

  it('never write a sign-in token or search terms', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const options = buildLoggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'production' });
    const app = Fastify({ logger: { ...(options as object), stream } });
    app.get('/v1/auth/magic-link/verify', async () => ({ ok: true }));
    app.get('/v1/matches/:id/messages/search', async () => ({ results: [] }));
    await app.inject({ method: 'GET', url: '/v1/auth/magic-link/verify?token=secret-token-123' });
    await app.inject({ method: 'GET', url: '/v1/matches/x/messages/search?q=my+home+address' });
    await app.close();
    const all = lines.join('');
    expect(all).toContain('/v1/auth/magic-link/verify');
    expect(all).not.toContain('secret-token-123');
    expect(all).not.toContain('home');
  });
});
