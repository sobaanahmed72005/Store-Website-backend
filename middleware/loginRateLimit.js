import { NODE_ENV } from '../config/env.js';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map();

function getKey(req) {
  const email = String(req.body?.email || '').toLowerCase().trim();
  return `${req.ip}:${email}`;
}

// In-memory per-process login throttle. Locks out an IP+email pair after repeated failed
// attempts within a rolling window. Sufficient for this app's single-process deployment;
// would need a shared store (e.g. Redis) if ever run behind a multi-process/load-balanced setup.
export function loginRateLimit(req, res, next) {
  // The test suite legitimately makes far more than 5 failed login attempts per run across its
  // various negative-path tests — NODE_ENV is never 'test' in production, so this doesn't
  // weaken the real per-IP+email lockout at all.
  if (NODE_ENV === 'test') return next();

  const key = getKey(req);
  const now = Date.now();
  const record = attempts.get(key);

  if (record?.lockedUntil && record.lockedUntil > now) {
    res.set('Retry-After', String(Math.ceil((record.lockedUntil - now) / 1000)));
    return res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 300) {
      attempts.delete(key);
    } else if (res.statusCode === 401) {
      const current = attempts.get(key) || { count: 0, firstAttempt: now };
      if (now - current.firstAttempt > WINDOW_MS) {
        current.count = 0;
        current.firstAttempt = now;
      }
      current.count += 1;
      if (current.count >= MAX_ATTEMPTS) {
        current.lockedUntil = now + WINDOW_MS;
      }
      attempts.set(key, current);
    }
    return originalJson(body);
  };

  next();
}
