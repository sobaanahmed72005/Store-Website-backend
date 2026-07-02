import pool from '../config/db.js';

async function hasPurchased(businessId, userId, productId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.business_id = ? AND o.user_id = ? AND oi.product_ref = ?
       AND o.status NOT IN ('cancelled', 'pending_payment')
     LIMIT 1`,
    [businessId, userId, String(productId)],
  );
  return rows.length > 0;
}

export async function getReviewEligibility(req, res) {
  const { product_id } = req.query;
  if (!product_id) return res.status(400).json({ error: 'product_id is required' });

  const [existing] = await pool.query(
    'SELECT id FROM product_reviews WHERE product_id = ? AND user_id = ?',
    [product_id, req.user.id],
  );
  const purchased = await hasPurchased(req.business.id, req.user.id, product_id);
  res.json({ purchased, alreadyReviewed: existing.length > 0 });
}

export async function getReviewsForProduct(req, res) {
  const { product_id } = req.query;
  if (!product_id) return res.status(400).json({ error: 'product_id is required' });

  const [rows] = await pool.query(
    `SELECT id, author_name, rating, comment, created_at
     FROM product_reviews
     WHERE business_id = ? AND product_id = ? AND status = 'approved'
     ORDER BY created_at DESC`,
    [req.business.id, product_id],
  );
  const count   = rows.length;
  const average = count > 0 ? rows.reduce((sum, r) => sum + r.rating, 0) / count : 0;
  res.json({ reviews: rows, average, count });
}

export async function createReview(req, res) {
  const { product_id, rating, comment } = req.body;
  const ratingNum = Number(rating);
  if (!product_id || !ratingNum || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'product_id and a rating between 1 and 5 are required' });
  }

  const [productRows] = await pool.query(
    'SELECT id FROM products WHERE id = ? AND business_id = ?',
    [product_id, req.business.id],
  );
  if (productRows.length === 0) return res.status(404).json({ error: 'Product not found' });

  const purchased = await hasPurchased(req.business.id, req.user.id, product_id);
  if (!purchased) {
    return res.status(403).json({ error: 'You can only review products you have purchased' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO product_reviews
         (business_id, product_id, user_id, author_name, rating, comment, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [req.business.id, product_id, req.user.id, req.user.name, ratingNum, comment ?? null],
    );
    res.status(201).json({ id: result.insertId, pending: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'You already reviewed this product' });
    throw err;
  }
}

export async function updateOwnReview(req, res) {
  const { rating, comment } = req.body;
  const ratingNum = Number(rating);
  if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'A rating between 1 and 5 is required' });
  }

  const [result] = await pool.query(
    `UPDATE product_reviews SET rating = ?, comment = ?, status = 'pending'
     WHERE id = ? AND business_id = ? AND user_id = ?`,
    [ratingNum, comment ?? null, req.params.id, req.business.id, req.user.id],
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
  res.json({ message: 'Review updated — it will go live once re-approved' });
}

export async function deleteOwnReview(req, res) {
  const [result] = await pool.query(
    'DELETE FROM product_reviews WHERE id = ? AND business_id = ? AND user_id = ?',
    [req.params.id, req.business.id, req.user.id],
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
  res.json({ message: 'Review deleted' });
}

// ── Admin ──────────────────────────────────────────────────────────────────

export async function adminListReviews(req, res) {
  const { status } = req.query; // 'pending' | 'approved' | undefined (all)
  const where = status && ['pending', 'approved'].includes(status)
    ? 'AND r.status = ?'
    : '';
  const params = [req.business.id, ...(where ? [status] : [])];

  const [rows] = await pool.query(
    `SELECT r.id, r.author_name, r.rating, r.comment, r.status, r.created_at,
            p.id AS product_id, p.name AS product_name
     FROM product_reviews r
     JOIN products p ON p.id = r.product_id
     WHERE r.business_id = ? ${where}
     ORDER BY FIELD(r.status,'pending','approved'), r.created_at DESC`,
    params,
  );
  res.json(rows);
}

export async function adminApproveReview(req, res) {
  const { action } = req.body; // 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }

  if (action === 'reject') {
    const [result] = await pool.query(
      'DELETE FROM product_reviews WHERE id = ? AND business_id = ?',
      [req.params.id, req.business.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
    return res.json({ message: 'Review rejected and removed' });
  }

  const [result] = await pool.query(
    `UPDATE product_reviews SET status = 'approved' WHERE id = ? AND business_id = ?`,
    [req.params.id, req.business.id],
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
  res.json({ message: 'Review approved' });
}

export async function adminCreateReview(req, res) {
  const { id } = req.params;
  const { author_name, rating, comment } = req.body;
  const ratingNum = Number(rating);
  if (!author_name?.trim() || !ratingNum || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'author_name and a rating between 1 and 5 are required' });
  }

  const [productRows] = await pool.query(
    'SELECT id FROM products WHERE id = ? AND business_id = ?',
    [id, req.business.id],
  );
  if (productRows.length === 0) return res.status(404).json({ error: 'Product not found' });

  const [result] = await pool.query(
    `INSERT INTO product_reviews
       (business_id, product_id, user_id, author_name, rating, comment, status)
     VALUES (?, ?, NULL, ?, ?, ?, 'approved')`,
    [req.business.id, id, author_name.trim(), ratingNum, comment ?? null],
  );
  res.status(201).json({ id: result.insertId });
}

export async function adminDeleteReview(req, res) {
  const [result] = await pool.query(
    'DELETE FROM product_reviews WHERE id = ? AND business_id = ?',
    [req.params.id, req.business.id],
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
  res.json({ message: 'Review deleted' });
}