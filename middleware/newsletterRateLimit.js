import rateLimit from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

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

// checkStatus/unsubscribe don't send mail, so the open-relay concern above doesn't apply, but
// both are unauthenticated and keyed only on a client-supplied email — with no limit at all, a
// script can enumerate which addresses are subscribed (checkStatus) at unlimited speed.
export const newsletterLookupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many requests. Please try again later.' },
});
