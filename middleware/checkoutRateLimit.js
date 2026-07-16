import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Mounted after requireAuth so it can key on the authenticated user rather than IP — a shared
// office/NAT IP shouldn't lock out other real customers checking out, but a single account
// scripting rapid repeat checkouts (draining limited stock, flooding the order/courier email
// pipeline) should still be stopped. Falls back to req.ip only if req.user is somehow unset —
// routed through ipKeyGenerator so that fallback normalizes IPv6 addresses to their /64 prefix
// instead of keying on the full address, which a client could vary to dodge the limit entirely.
function keyByUser(req) {
  return req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip);
}

export const checkoutRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many orders placed. Please try again later.' },
});

// Payment-proof screenshots are also never cleaned up if their order is abandoned — this doesn't
// fix that (see docs/AUDIT.md), but at least bounds how many an account can pile up per window.
export const paymentProofRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many uploads. Please try again later.' },
});
