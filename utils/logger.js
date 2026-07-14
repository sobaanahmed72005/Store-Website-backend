import pino from 'pino';
import { NODE_ENV, IS_PRODUCTION } from '../config/env.js';

// JSON in production (for log aggregation — e.g. Railway's log drain, or shipping to a service
// later), pretty-printed and colorized in development where a human is actually reading the
// terminal. Level defaults to 'debug' outside production so nothing's silently suppressed
// during local dev, and 'info' in production to skip debug-level noise at volume. Silent during
// the test suite — pino-http's full request/response dump per request drowns out the actual
// test output otherwise, and a test failure's assertion message is the useful signal there, not
// the request log.
export const logger = pino({
  level: NODE_ENV === 'test' ? 'silent' : (IS_PRODUCTION ? 'info' : 'debug'),
  base: { env: NODE_ENV },
  transport: IS_PRODUCTION
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,env' } },
});
