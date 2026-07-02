import pool from '../config/db.js';

export async function getCart(req, res) {
  const { userId } = req.params;
  const [rows] = await pool.query(
    'SELECT id, product_ref, product_name, product_image, product_slug, price, quantity FROM cart_items WHERE business_id = ? AND user_id = ?',
    [req.business.id, userId]
  );
  res.json(rows);
}

const MAX_CART_QTY_PER_LINE = 999;

export async function replaceCart(req, res) {
  const { userId } = req.params;
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM cart_items WHERE business_id = ? AND user_id = ?', [req.business.id, userId]);
    for (const item of items) {
      const qty = Math.trunc(Number(item.qty));
      const safeQty = Number.isInteger(qty) && qty >= 1 ? Math.min(qty, MAX_CART_QTY_PER_LINE) : 1;
      await connection.query(
        'INSERT INTO cart_items (business_id, user_id, product_ref, product_name, product_image, product_slug, price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [req.business.id, userId, String(item.id), item.title, item.image ?? null, item.slug ?? null, item.price, safeQty]
      );
    }
    await connection.commit();
    res.json({ message: 'Cart synced' });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}