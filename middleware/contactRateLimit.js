import rateLimit from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Throttles the contact form per IP — it's unauthenticated and sends a real email to the store
// owner on every request, so with no limit it's an easy way to spam/mailbomb the store's inbox.
export const contactRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Every sibling *RateLimit.js exempts the test suite the same way — this one just hasn't
  // needed it yet since only 2 contact-form tests exist today, under the limit of 5. Added for
  // consistency so a future 6th test doesn't start silently flaking on this one limiter alone.
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many messages sent. Please try again later.' },
});
