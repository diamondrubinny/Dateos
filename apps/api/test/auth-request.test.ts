import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER } from '../src/auth/auth.js';
import { toFetchRequest } from '../src/auth/routes.js';

describe('toFetchRequest', () => {
  it('drops client-supplied IP headers and sets the verified client IP', async () => {
    const app = Fastify();
    let forwarded: Request | undefined;
    app.post('/v1/auth/x', async (request) => {
      forwarded = toFetchRequest(request, 'http://localhost:4000');
      return {};
    });
    await app.inject({
      method: 'POST',
      url: '/v1/auth/x?y=1',
      remoteAddress: '203.0.113.7',
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '1.2.3.4',
        'cf-connecting-ip': '1.2.3.4',
        [CLIENT_IP_HEADER]: '1.2.3.4',
        cookie: 'a=b',
      },
      payload: { email: 'a@example.test' },
    });
    expect(forwarded!.url).toBe('http://localhost:4000/v1/auth/x?y=1');
    expect(forwarded!.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7');
    expect(forwarded!.headers.get('x-forwarded-for')).toBeNull();
    expect(forwarded!.headers.get('x-real-ip')).toBeNull();
    expect(forwarded!.headers.get('cf-connecting-ip')).toBeNull();
    expect(forwarded!.headers.get('cookie')).toBe('a=b');
    expect(await forwarded!.json()).toEqual({ email: 'a@example.test' });
    await app.close();
  });
});
