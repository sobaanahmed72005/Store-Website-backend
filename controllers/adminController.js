import fs from 'fs/promises';
import path from 'path';
import pool from '../config/db.js';
import { sanitizeUploadedImage } from '../utils/imageProcessing.js';

export async function getStats(req, res) {
  const businessId = req.business.id;
  const [[{ totalProducts }]] = await pool.query('SELECT COUNT(*) AS totalProducts FROM products WHERE business_id = ?', [businessId]);
  const [[{ totalCategories }]] = await pool.query('SELECT COUNT(*) AS totalCategories FROM categories WHERE business_id = ?', [businessId]);
  const [[{ totalOrders }]] = await pool.query('SELECT COUNT(*) AS totalOrders FROM orders WHERE business_id = ?', [businessId]);
  const [[{ totalUsers }]] = await pool.query("SELECT COUNT(*) AS totalUsers FROM users WHERE business_id = ? AND role = 'customer'", [businessId]);
  const [[{ totalRevenue }]] = await pool.query(
    "SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue FROM orders WHERE business_id = ? AND status NOT IN ('cancelled', 'returned')",
    [businessId]
  );
  const [[{ pendingOrders }]] = await pool.query("SELECT COUNT(*) AS pendingOrders FROM orders WHERE business_id = ? AND status = 'pending'", [businessId]);
  const [[{ lowStock }]] = await pool.query('SELECT COUNT(*) AS lowStock FROM products WHERE business_id = ? AND stock <= 5', [businessId]);

  res.json({ totalProducts, totalCategories, totalOrders, totalUsers, totalRevenue, pendingOrders, lowStock });
}

export async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let format;
  try {
    format = await sanitizeUploadedImage(req.file.path);
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'That file is not a valid image' });
  }

  // Rename to an extension derived from the sanitized image's real, validated format —
  // never the client-supplied original filename's extension, which is attacker-controlled
  // and unrelated to what bytes actually ended up on disk after sanitization.
  const { dir, name } = path.parse(req.file.path);
  const safeFilename = `${name}.${format}`;
  await fs.rename(req.file.path, path.join(dir, safeFilename));

  res.status(201).json({ url: `/uploads/${safeFilename}` });
}
