import rateLimit from 'express-rate-limit';

// Throttles account-creation and password-reset requests per IP to stop signup spam
// and mail-bombing via forgot-password, without the per-email lockout semantics login uses.
export const accountActionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
