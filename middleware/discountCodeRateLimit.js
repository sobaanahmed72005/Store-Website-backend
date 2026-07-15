import rateLimit from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Any logged-in customer could otherwise script unlimited guesses at another merchant's
// promo codes through this endpoint — a dedicated per-IP limiter, separate from
// accountActionRateLimit's pool, since this isn't an account-security action.
export const discountCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many attempts. Please try again later.' },
});
