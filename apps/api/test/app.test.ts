// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { apiErrorSchema } from '@nexaheart/shared';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { baseEnv, buildTestApp, fakeDependency } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health', () => {
  it('GET /health returns ok without touching dependencies', async () => {
    const db = fakeDependency('postgres', false);
    ({ app } = await buildTestApp({}, [db]));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready returns 200 when every dependency is up', async () => {
    ({ app } = await buildTestApp());
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { postgres: 'up', redis: 'up' } });
  });

  it('GET /ready returns 503 when a dependency is down', async () => {
    ({ app } = await buildTestApp({}, [
      fakeDependency('postgres'),
      fakeDependency('redis', false),
    ]));
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { postgres: 'up', redis: 'down' } });
  });
});

describe('errors', () => {
  it('returns the standard envelope for unknown routes', async () => {
    ({ app } = await buildTestApp());
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('hides internal error details', async () => {
    ({ app } = await buildTestApp());
    app.get('/boom', async () => {
      throw new Error('db password is hunter2');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('INTERNAL_ERROR');
  });

  it('keeps unmapped client errors as 4xx', async () => {
    ({ app } = await buildTestApp());
    app.get('/teapot', async () => {
      throw Object.assign(new Error('short and stout'), { statusCode: 418 });
    });
    const res = await app.inject({ method: 'GET', url: '/teapot' });
    expect(res.statusCode).toBe(418);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('rejects malformed JSON with a safe message', async () => {
    ({ app } = await buildTestApp());
    app.post('/echo', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.message).toBe(
      'The request could not be processed.',
    );
  });

  it('rejects bodies over the configured limit', async () => {
    ({ app } = await buildTestApp({ BODY_LIMIT_BYTES: '100' }));
    app.post('/echo', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { data: 'x'.repeat(500) },
    });
    expect(res.statusCode).toBe(413);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('closes dependencies on shutdown', async () => {
    const db = fakeDependency('postgres');
    const built = await buildTestApp({}, [db]);
    await built.app.close();
    expect(db.closed).toBe(true);
  });
});

describe('security', () => {
  it('sets strict security headers', async () => {
    ({ app } = await buildTestApp());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sends HSTS only in production', async () => {
    ({ app } = await buildTestApp({
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://api.example',
      AUTH_SECRET: 'x'.repeat(32),
    }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('blocks cross-origin requests from origins not on the allowlist', async () => {
    ({ app } = await buildTestApp({ CORS_ORIGINS: 'https://app.example' }));
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example' },
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits requests and keeps the error envelope', async () => {
    ({ app } = await buildTestApp({ RATE_LIMIT_MAX: '2' }));
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 3; i += 1) {
      last = await app.inject({ method: 'GET', url: '/ready' });
      statuses.push(last.statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(apiErrorSchema.parse(last!.json()).error.code).toBe('RATE_LIMITED');
  });

  it('never rate limits the liveness probe', async () => {
    ({ app } = await buildTestApp({ RATE_LIMIT_MAX: '1' }));
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('keeps serving when the rate-limit store is unreachable', async () => {
    const deadRedis = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    deadRedis.on('error', () => undefined);
    try {
      app = await buildApp(loadEnv(baseEnv), {
        dependencies: [fakeDependency('postgres'), fakeDependency('redis', false)],
        redis: deadRedis,
      });
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        status: 'not_ready',
        checks: { postgres: 'up', redis: 'down' },
      });
    } finally {
      deadRedis.disconnect();
    }
  });
});
