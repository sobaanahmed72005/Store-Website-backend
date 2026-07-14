import rateLimit from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// A legitimate client calls this roughly once per access-token lifetime (~15 min), so this
// just needs to be generous enough for several tabs/devices behind the same IP while still
// stopping a scripted refresh loop.
export const refreshRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many requests. Please try again later.' },
});
