import rateLimit from 'express-rate-limit';

// Throttles the contact form per IP — it's unauthenticated and sends a real email to the store
// owner on every request, so with no limit it's an easy way to spam/mailbomb the store's inbox.
export const contactRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please try again later.' },
});
