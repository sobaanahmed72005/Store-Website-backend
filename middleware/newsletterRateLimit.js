import rateLimit from 'express-rate-limit';

// Throttles newsletter signup per IP. subscribe() emails whatever address is submitted — with
// no limit this is effectively an open relay for the store's SMTP account against any inbox,
// not just spam against the store itself.
export const newsletterRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
