import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { AUTH_COOKIE } from '../utils/authCookies.js';

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Joining against sessions confirms this specific device's session is still valid —
    // not revoked by a logout on this device, or by an account-wide revocation from a
    // password change / 2FA disable on any device. A missing row covers both cases.
    const [rows] = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.email_verified, u.saved_phone, u.saved_address, u.saved_city, u.totp_enabled
       FROM users u
       JOIN sessions s ON s.user_id = u.id
       WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL`,
      [payload.id, payload.session_id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Session expired, please sign in again' });
    if (!req.business || rows[0].business_id !== req.business.id) {
      return res.status(401).json({ error: 'Invalid token for this store' });
    }
    req.user = rows[0];
    req.sessionId = payload.session_id;
    next();
  } catch {
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
