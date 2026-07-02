import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.query(
      'SELECT id, business_id, name, email, role, email_verified, saved_phone, saved_address, saved_city FROM users WHERE id = ?',
      [payload.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    if (!req.business || rows[0].business_id !== req.business.id) {
      return res.status(401).json({ error: 'Invalid token for this store' });
    }
    req.user = rows[0];
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
