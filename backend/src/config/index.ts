import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

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

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const rawConfig = {
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    database: {
      url: process.env.DATABASE_URL || 'postgresql://opsmap:opsmap@localhost:5432/opsmap',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    jwt: {
      secret: process.env.JWT_SECRET || 'development-secret-key-change-in-production',
      expiresIn: process.env.JWT_EXPIRES_IN,
    },
    oidc: {
      enabled: process.env.OIDC_ENABLED,
      issuer: process.env.OIDC_ISSUER,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
    },
    cors: {
      origin: process.env.CORS_ORIGIN,
    },
    logging: {
      level: process.env.LOG_LEVEL,
    },
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
