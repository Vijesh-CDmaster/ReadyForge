import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * config.ts evaluates its production guard at import time, so each case re-imports
 * the module on a clean registry. Env keys are pre-set (even to '') because
 * `dotenv/config` fills in any key that is entirely absent from process.env.
 */
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
};

afterEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('production startup guard', () => {
  it('refuses to boot in production when a JWT secret is missing', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'prod-access';
    process.env.JWT_REFRESH_SECRET = '';
    await expect(import('../config')).rejects.toThrow(/JWT_REFRESH_SECRET/);
  });

  it('refuses to boot in production when both secrets are missing', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = '';
    process.env.JWT_REFRESH_SECRET = '';
    await expect(import('../config')).rejects.toThrow(/must both be set/);
  });

  it('boots in production when both secrets are set', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'prod-access';
    process.env.JWT_REFRESH_SECRET = 'prod-refresh';
    const { config } = await import('../config');
    expect(config.isProd).toBe(true);
    expect(config.jwt.accessSecret).toBe('prod-access');
    expect(config.jwt.refreshSecret).toBe('prod-refresh');
  });

  it('keeps zero-config dev fallbacks when secrets are absent', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = '';
    process.env.JWT_REFRESH_SECRET = '';
    const { config } = await import('../config');
    expect(config.isProd).toBe(false);
    expect(config.jwt.accessSecret).toBe('dev-access-secret');
    expect(config.jwt.refreshSecret).toBe('dev-refresh-secret');
  });
});
