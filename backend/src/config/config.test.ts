import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Test the config schema validation directly without loading the module
// (since the module calls loadConfig() at import time)

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  database: z.object({
    url: z.string(),
  }),
  redis: z.object({
    url: z.string(),
  }),
  jwt: z.object({
    secret: z.string().min(32),
    expiresIn: z.string().default('24h'),
  }),
  oidc: z.object({
    enabled: z.coerce.boolean().default(false),
    issuer: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
  }),
  cors: z.object({
    origin: z.string().default('http://localhost:5173'),
  }),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }),
});

function createValidConfig(overrides: Record<string, unknown> = {}) {
  return {
    port: 3000,
    nodeEnv: 'development',
    database: { url: 'postgresql://localhost:5432/opsmap' },
    redis: { url: 'redis://localhost:6379' },
    jwt: {
      secret: 'a-secret-key-that-is-at-least-32-characters-long',
      expiresIn: '24h',
    },
    oidc: { enabled: false },
    cors: { origin: 'http://localhost:5173' },
    logging: { level: 'info' },
    ...overrides,
  };
}

describe('Config schema validation', () => {
  it('should accept valid configuration', () => {
    const result = configSchema.safeParse(createValidConfig());
    expect(result.success).toBe(true);
  });

  it('should apply default values', () => {
    const minimal = {
      database: { url: 'postgresql://localhost/db' },
      redis: { url: 'redis://localhost:6379' },
      jwt: { secret: 'a-secret-key-that-is-at-least-32-characters-long' },
      oidc: {},
      cors: {},
      logging: {},
    };

    const result = configSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(3000);
      expect(result.data.nodeEnv).toBe('development');
      expect(result.data.jwt.expiresIn).toBe('24h');
      expect(result.data.oidc.enabled).toBe(false);
      expect(result.data.cors.origin).toBe('http://localhost:5173');
      expect(result.data.logging.level).toBe('info');
    }
  });

  it('should coerce port from string to number', () => {
    const config = createValidConfig({ port: '8080' });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(8080);
    }
  });

  it('should coerce oidc.enabled from string to boolean', () => {
    const config = createValidConfig({ oidc: { enabled: 'true' } });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.oidc.enabled).toBe(true);
    }
  });

  it('should reject invalid nodeEnv', () => {
    const config = createValidConfig({ nodeEnv: 'staging' });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject invalid logging level', () => {
    const config = createValidConfig({ logging: { level: 'verbose' } });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject JWT secret shorter than 32 characters', () => {
    const config = createValidConfig({ jwt: { secret: 'short' } });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject missing database URL', () => {
    const config = createValidConfig({ database: {} });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject missing redis URL', () => {
    const config = createValidConfig({ redis: {} });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept all valid nodeEnv values', () => {
    for (const env of ['development', 'production', 'test']) {
      const config = createValidConfig({ nodeEnv: env });
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('should accept all valid logging levels', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      const config = createValidConfig({ logging: { level } });
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('should accept optional OIDC fields', () => {
    const config = createValidConfig({
      oidc: {
        enabled: true,
        issuer: 'https://login.company.com',
        clientId: 'opsmap',
        clientSecret: 'secret',
      },
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.oidc.issuer).toBe('https://login.company.com');
    }
  });
});
