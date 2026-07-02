import pool from '../config/db.js';

export async function getWishlist(req, res) {
  const [rows] = await pool.query(
    `SELECT w.product_id, p.id, p.name, p.slug, p.image, p.price, p.discount_price, p.stock
     FROM wishlist_items w
     JOIN products p ON p.id = w.product_id
     WHERE w.business_id = ? AND w.user_id = ?
     ORDER BY w.created_at DESC`,
    [req.business.id, req.user.id]
  );
  res.json(rows);
}

export async function addToWishlist(req, res) {
  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id is required' });

  const [products] = await pool.query('SELECT id FROM products WHERE id = ? AND business_id = ?', [product_id, req.business.id]);
  if (products.length === 0) return res.status(404).json({ error: 'Product not found' });

  await pool.query(
    'INSERT INTO wishlist_items (business_id, user_id, product_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE product_id = product_id',
    [req.business.id, req.user.id, product_id]
  );
  res.status(201).json({ message: 'Added to wishlist' });
}

export async function removeFromWishlist(req, res) {
  await pool.query('DELETE FROM wishlist_items WHERE business_id = ? AND user_id = ? AND product_id = ?', [req.business.id, req.user.id, req.params.productId]);
  res.json({ message: 'Removed from wishlist' });
}