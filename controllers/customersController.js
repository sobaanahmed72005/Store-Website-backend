import pool from '../config/db.js';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination.js';
import { logAudit } from '../utils/auditLog.js';

export async function getCustomers(req, res) {
  const { page, limit, offset } = parsePagination(req, 50);
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM users WHERE business_id = ? AND role = 'customer'`,
    [req.business.id]
  );
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.saved_phone, u.saved_address, u.saved_city, u.email_verified, u.created_at,
            COUNT(o.id) AS order_count,
            COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END), 0) AS total_spent
     FROM users u
     LEFT JOIN orders o ON o.user_id = u.id AND o.business_id = u.business_id
     WHERE u.business_id = ? AND u.role = 'customer'
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.business.id, limit, offset]
  );
  res.json(buildPaginatedResponse('customers', rows, total, page, limit));
}

export async function getCustomerById(req, res) {
  const [rows] = await pool.query(
    'SELECT id, name, email, phone, saved_phone, saved_address, saved_city, email_verified, created_at FROM users WHERE id = ? AND business_id = ? AND role = \'customer\'',
    [req.params.id, req.business.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

  const [orders] = await pool.query('SELECT * FROM orders WHERE user_id = ? AND business_id = ? ORDER BY created_at DESC', [req.params.id, req.business.id]);
  res.json({ ...rows[0], orders });
}

export async function updateCustomerCity(req, res) {
  const { saved_city } = req.body;
  const newCity = (saved_city || '').trim();
  if (!newCity) {
    return res.status(400).json({ error: 'City is required' });
  }

  const [existing] = await pool.query(
    `SELECT id, name FROM users WHERE id = ? AND business_id = ? AND role = 'customer'`,
    [req.params.id, req.business.id]
  );
  if (existing.length === 0) return res.status(404).json({ error: 'Customer not found' });

  await pool.query(
    `UPDATE users SET saved_city = ? WHERE id = ? AND business_id = ? AND role = 'customer'`,
    [newCity, req.params.id, req.business.id]
  );

  await pool.query(
    `UPDATE orders SET shipping_city = ? WHERE user_id = ? AND business_id = ? AND status IN ('pending', 'confirmed', 'packed')`,
    [newCity, req.params.id, req.business.id]
  );

  logAudit({
    req,
    action: 'customer.update_city',
    entityType: 'user',
    entityId: req.params.id,
    details: { saved_city: newCity }
  });

  res.json({ message: 'Customer city updated successfully', saved_city: newCity });
}