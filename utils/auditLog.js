import pool from '../config/db.js';

const PAGE_SIZE = 50;

export async function listAuditLogs(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [rows] = await pool.query(
    'SELECT * FROM audit_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [req.business.id, PAGE_SIZE, offset]
  );
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM audit_logs WHERE business_id = ?', [req.business.id]);

  res.json({
    entries: rows.map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null })),
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
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
    console.error('[audit log] failed to record entry:', err.message);
  }
}
