import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Dedicated limiter for the 2FA login-challenge step, separate from accountActionRateLimit's
// shared pool (register/forgot-password/reset-password). Those are unrelated actions — pooling
// them meant a few fumbled password-reset attempts could burn through the budget a legitimate
// user needs to submit their real 2FA code. The challenge itself is also capped independently
// at 5 attempts per challengeId with a 5-minute TTL (see utils/challengeStore.js) — that's the
// real backstop against brute-forcing a single code; this limiter is defense-in-depth per IP.
// Unauthenticated by nature (no session yet at the login-challenge step), so IP is the only option.
export const twoFactorRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many attempts. Please try again later.' },
});

// Same limit/window as above, but keyed by user id for the sibling routes that are actually
// requireAuth-gated (2fa/setup, 2fa/confirm, 2fa/disable) — sharing the IP bucket meant one
// user's fumbled attempts could 429-lock every other user behind the same office/NAT/shared IP
// out of their own 2FA management, even though they'd done nothing wrong. Matches the same
// keying already used for authenticatedAccountActionRateLimit/checkoutRateLimit/reviewRateLimit.
// Falls back to ipKeyGenerator only if req.user is somehow unset, which normalizes IPv6
// addresses instead of keying on the raw (spoofable-via-/64) address.
export const authenticatedTwoFactorRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip)),
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many attempts. Please try again later.' },
});
