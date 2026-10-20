import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { baseEnv } from './helpers.js';

describe('loadEnv', () => {
  it('applies safe defaults', () => {
    const env = loadEnv(baseEnv);
    expect(env.PORT).toBe(4000);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.BODY_LIMIT_BYTES).toBe(65_536);
  });

  it('parses comma-separated origins', () => {
    const env = loadEnv({ ...baseEnv, CORS_ORIGINS: 'https://a.example, https://b.example,' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('reports missing keys without leaking values', () => {
    const secret = 'postgres://user:super-secret-password@db/x';
    try {
      loadEnv({ NODE_ENV: 'test', DATABASE_URL: secret, REDIS_URL: 'not a url' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).invalidKeys).toEqual(['REDIS_URL']);
      expect((error as Error).message).not.toContain('super-secret-password');
    }
  });

  it('rejects non-postgres database URLs', () => {
    expect(() => loadEnv({ ...baseEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      EnvValidationError,
    );
  });

  it('requires https and an auth secret in production', () => {
    try {
      loadEnv({ ...baseEnv, NODE_ENV: 'production' });
      expect.unreachable();
    } catch (error) {
      expect((error as EnvValidationError).invalidKeys).toEqual(['PUBLIC_API_URL', 'AUTH_SECRET']);
    }
  });

  it('forbids wildcard CORS in production', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(
      EnvValidationError,
    );
  });
});
