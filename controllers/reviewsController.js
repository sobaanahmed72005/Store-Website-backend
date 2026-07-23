import pool from '../config/db.js';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination.js';

async function hasPurchased(businessId, userId, productId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.business_id = ? AND o.user_id = ? AND oi.product_ref = ?
       AND o.status != 'cancelled'
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

  // average/total are computed over every approved review, independent of the LIMIT/OFFSET
  // below — the rating summary shouldn't change depending on which page of reviews is showing.
  const { page, limit, offset } = parsePagination(req, 10);
  const [[{ total, average }]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(AVG(rating), 0) AS average
     FROM product_reviews WHERE business_id = ? AND product_id = ? AND status = 'approved'`,
    [req.business.id, product_id],
  );
  const [rows] = await pool.query(
    `SELECT id, author_name, rating, comment, created_at
     FROM product_reviews
     WHERE business_id = ? AND product_id = ? AND status = 'approved'
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [req.business.id, product_id, limit, offset],
  );
  res.json({ ...buildPaginatedResponse('reviews', rows, total, page, limit), average: Number(average) });
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
  const { status } = req.query; // 'pending' | 'approved' | 'rejected' | undefined (all)
  const { page, limit, offset } = parsePagination(req, 50);
  const where = status && ['pending', 'approved', 'rejected'].includes(status)
    ? 'AND r.status = ?'
    : '';
  const params = [req.business.id, ...(where ? [status] : [])];

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM product_reviews r WHERE r.business_id = ? ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT r.id, r.author_name, r.rating, r.comment, r.status, r.created_at,
            p.id AS product_id, p.name AS product_name
     FROM product_reviews r
     JOIN products p ON p.id = r.product_id
     WHERE r.business_id = ? ${where}
     ORDER BY FIELD(r.status,'pending','approved','rejected'), r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json(buildPaginatedResponse('reviews', rows, total, page, limit));
}

export async function adminApproveReview(req, res) {
  const { action } = req.body; // 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }

  const status = action === 'reject' ? 'rejected' : 'approved';
  const [result] = await pool.query(
    `UPDATE product_reviews SET status = ? WHERE id = ? AND business_id = ?`,
    [status, req.params.id, req.business.id],
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
  res.json({ message: action === 'reject' ? 'Review rejected' : 'Review approved' });
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