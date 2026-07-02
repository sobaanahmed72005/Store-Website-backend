import pool from '../config/db.js';

export async function getCustomers(req, res) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.email_verified, u.created_at,
            COUNT(o.id) AS order_count,
            COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END), 0) AS total_spent
     FROM users u
     LEFT JOIN orders o ON o.user_id = u.id AND o.business_id = u.business_id
     WHERE u.business_id = ? AND u.role = 'customer'
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
    [req.business.id]
  );
  res.json(rows);
}

export async function getCustomerById(req, res) {
  const [rows] = await pool.query(
    'SELECT id, name, email, phone, email_verified, created_at FROM users WHERE id = ? AND business_id = ? AND role = \'customer\'',
    [req.params.id, req.business.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

  const [orders] = await pool.query('SELECT * FROM orders WHERE user_id = ? AND business_id = ? ORDER BY created_at DESC', [req.params.id, req.business.id]);
  res.json({ ...rows[0], orders });
}