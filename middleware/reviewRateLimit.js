import rateLimit from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Mounted after requireAuth — keys on the authenticated user, not IP, for the same reason as
// checkoutRateLimit. Create/update/delete share one budget since they're all the same kind of
// account action (submitting review content), not separately-abusable surfaces.
export const reviewRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : req.ip),
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many requests. Please try again later.' },
});
