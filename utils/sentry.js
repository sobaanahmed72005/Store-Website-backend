import * as Sentry from '@sentry/node';
import { SENTRY_DSN, NODE_ENV } from '../config/env.js';

// No-ops everywhere below when SENTRY_DSN isn't set (e.g. local dev without a Sentry account,
// or the test suite) — errors are still logged locally either way via utils/logger.js, this is
// strictly additive alerting/aggregation on top, never a requirement to run the app.
if (SENTRY_DSN && NODE_ENV !== 'test') {
  Sentry.init({ dsn: SENTRY_DSN, environment: NODE_ENV });
}

export { Sentry };
