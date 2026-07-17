import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { NODE_ENV } from '../config/env.js';

// Throttles account-creation and password-reset requests per IP to stop signup spam
// and mail-bombing via forgot-password, without the per-email lockout semantics login uses.
// Unauthenticated by nature (there's no account to key on yet), so IP is the only option.
export const accountActionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // The test suite legitimately registers far more than 10 accounts per run — NODE_ENV is
  // never 'test' in production, so this doesn't weaken the real per-IP throttle at all.
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many requests. Please try again later.' },
});

// Same limit/window as above, but keyed by user id for the sibling routes that are actually
// requireAuth-gated (update profile, change password, resend verification) — sharing the IP
// bucket with unauthenticated register/forgot-password traffic meant unrelated signup or
// password-reset requests from other people on a shared office/NAT IP could transiently 429 a
// real logged-in user's own change-password attempt. Matches the same keying already used for
// checkoutRateLimit/reviewRateLimit. Falls back to ipKeyGenerator only if req.user is somehow
// unset, which normalizes IPv6 addresses instead of keying on the raw (spoofable-via-/64) address.
export const authenticatedAccountActionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip)),
  skip: () => NODE_ENV === 'test',
  message: { error: 'Too many requests. Please try again later.' },
});
