import pino from 'pino';
import { config } from '../config/env';
import { getContext } from './context';

const usePretty = !config.isProduction && !config.isTest;

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  base: { role: config.APP_ROLE },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
    ],
    censor: '[redacted]',
  },
  // Every log line carries the request/user it belongs to (when inside a request).
  mixin() {
    const ctx = getContext();
    return ctx ? { requestId: ctx.requestId, userId: ctx.userId } : {};
  },
  transport: usePretty
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,role' },
      }
    : undefined,
});
