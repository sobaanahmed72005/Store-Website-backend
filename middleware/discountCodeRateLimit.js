import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Any logged-in customer could otherwise script unlimited guesses at another merchant's
// promo codes through this endpoint — a dedicated limiter, separate from
// accountActionRateLimit's pool, since this isn't an account-security action. Keyed by user id
// (falling back to ipKeyGenerator only if req.user is somehow unset, this route is requireAuth-
// gated) rather than IP — an IP-keyed bucket here meant one customer scripting bogus codes could
// 429-lock out every other customer checking out from the same office/NAT IP, on their very
// first legitimate attempt. Matches the same keying already used for checkoutRateLimit,
// reviewRateLimit, and authenticatedAccountActionRateLimit.
export const discountCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip)),
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many attempts. Please try again later.' },
});
