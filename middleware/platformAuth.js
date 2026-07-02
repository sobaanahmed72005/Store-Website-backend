import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

export async function requirePlatformAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'platform') return res.status(401).json({ error: 'Invalid token' });

    const [rows] = await pool.query('SELECT id, name, email FROM platform_admins WHERE id = ?', [payload.id]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid token' });
    req.platformAdmin = rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}