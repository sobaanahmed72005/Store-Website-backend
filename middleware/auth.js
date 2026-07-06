import jwt from 'jsonwebtoken';
import { AUTH_COOKIE } from '../utils/authCookies.js';
import { JWT_SECRET } from '../config/env.js';

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // The refresh token is also a signed JWT (see controllers/authController.js) — without this
    // check, a leaked refresh token would work here too, defeating its longer-but-more-sensitive
    // lifetime, and an access token would work at /auth/refresh, letting it mint new access
    // tokens indefinitely instead of expiring for good after 15 minutes.
    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!req.business || payload.business_id !== req.business.id) {
      return res.status(401).json({ error: 'Invalid token for this store' });
    }
    req.user = payload;
    next();
  } catch (err) {
    // A distinct code for expiry (vs. a tampered/malformed token) lets the frontend tell the
    // difference between "call /auth/refresh to get a new access token" and "send the user
    // back to sign-in" — access tokens are expected to expire every 15 minutes by design.
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

export function requireSelfOrAdmin(paramName) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (req.user.role === 'admin' || String(req.user.id) === String(req.params[paramName])) return next();
      return res.status(403).json({ error: 'Forbidden' });
    });
  };
}
