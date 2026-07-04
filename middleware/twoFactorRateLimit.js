import rateLimit from 'express-rate-limit';

// Dedicated limiter for the 2FA login-challenge step, separate from accountActionRateLimit's
// shared pool (register/forgot-password/reset-password). Those are unrelated actions — pooling
// them meant a few fumbled password-reset attempts could burn through the budget a legitimate
// user needs to submit their real 2FA code. The challenge itself is also capped independently
// at 5 attempts per challengeId with a 5-minute TTL (see utils/challengeStore.js) — that's the
// real backstop against brute-forcing a single code; this limiter is defense-in-depth per IP.
export const twoFactorRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});
