import rateLimit from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Throttles account-creation and password-reset requests per IP to stop signup spam
// and mail-bombing via forgot-password, without the per-email lockout semantics login uses.
export const accountActionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // The test suite legitimately registers far more than 10 accounts per run — NODE_ENV is
  // never 'test' in production, so this doesn't weaken the real per-IP throttle at all.
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many requests. Please try again later.' },
});
