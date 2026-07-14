import pool from '../config/db.js';
import { logger } from './logger.js';
import { parsePagination, buildPaginatedResponse } from './pagination.js';

export async function listAuditLogs(req, res) {
  const { page, limit, offset } = parsePagination(req, 50);

  const [rows] = await pool.query(
    'SELECT * FROM audit_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [req.business.id, limit, offset]
  );
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM audit_logs WHERE business_id = ?', [req.business.id]);

  const entries = rows.map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
  res.json(buildPaginatedResponse('entries', entries, total, page, limit));
}

// Never let a logging failure break the admin action it's recording.
export async function logAudit({ req, action, entityType, entityId, details }) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (business_id, user_id, user_name, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        req.business.id,
        req.user?.id ?? null,
        req.user?.name ?? null,
        action,
        entityType,
        entityId != null ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        req.ip ?? null,
      ]
    );
  } catch (err) {
    logger.error({ err, action, entityType, entityId }, 'Failed to record audit log entry');
  }
}
