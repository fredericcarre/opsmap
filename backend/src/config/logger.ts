import pino from 'pino';
import { config } from './index.js';

export const logger = pino({
  level: config.logging.level,
  transport: config.nodeEnv === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

export const createChildLogger = (name: string) => logger.child({ module: name });
