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

  // Validate and normalize every line up front, before any of this reaches the DB. product_name
  // and price are NOT NULL columns — mysql2 rejects `undefined` bind params outright, so a line
  // missing a title/price previously crashed with a raw driver error instead of a clean 400.
  // Lines are also merged by product id here rather than inserted as separate rows, since two
  // rows for the same product would hit the unique_user_product constraint the same uncaught way.
  const cleanedByProductRef = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.id == null) {
      return res.status(400).json({ error: 'Each cart item must include an id' });
    }
    const title = String(item.title ?? '').trim();
    if (!title) return res.status(400).json({ error: `Item ${item.id} is missing a title` });
    const price = Number(item.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: `Item ${item.id} has an invalid price` });
    }
    const qty = Math.trunc(Number(item.qty));
    const safeQty = Number.isInteger(qty) && qty >= 1 ? Math.min(qty, MAX_CART_QTY_PER_LINE) : 1;

    const productRef = String(item.id);
    const existing = cleanedByProductRef.get(productRef);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + safeQty, MAX_CART_QTY_PER_LINE);
    } else {
      cleanedByProductRef.set(productRef, {
        productRef, title, price, quantity: safeQty,
        image: item.image ?? null, slug: item.slug ?? null,
      });
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM cart_items WHERE business_id = ? AND user_id = ?', [req.business.id, userId]);
    for (const item of cleanedByProductRef.values()) {
      await connection.query(
        'INSERT INTO cart_items (business_id, user_id, product_ref, product_name, product_image, product_slug, price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [req.business.id, userId, item.productRef, item.title, item.image, item.slug, item.price, item.quantity]
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