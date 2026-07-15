import pool from '../config/db.js';
import { handleImageUpload } from '../utils/uploadHandler.js';

export async function getStats(req, res) {
  const businessId = req.business.id;
  // These 7 counts are all independent of each other — running them sequentially just serialized
  // 7 round trips for no reason (each one waiting on the last to finish before starting).
  const [
    [[{ totalProducts }]],
    [[{ totalCategories }]],
    [[{ totalOrders }]],
    [[{ totalUsers }]],
    [[{ totalRevenue }]],
    [[{ pendingOrders }]],
    [[{ lowStock }]],
  ] = await Promise.all([
    pool.query('SELECT COUNT(*) AS totalProducts FROM products WHERE business_id = ?', [businessId]),
    pool.query('SELECT COUNT(*) AS totalCategories FROM categories WHERE business_id = ?', [businessId]),
    pool.query('SELECT COUNT(*) AS totalOrders FROM orders WHERE business_id = ?', [businessId]),
    pool.query("SELECT COUNT(*) AS totalUsers FROM users WHERE business_id = ? AND role = 'customer'", [businessId]),
    pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue FROM orders WHERE business_id = ? AND status NOT IN ('cancelled', 'returned')",
      [businessId]
    ),
    pool.query("SELECT COUNT(*) AS pendingOrders FROM orders WHERE business_id = ? AND status = 'pending'", [businessId]),
    pool.query('SELECT COUNT(*) AS lowStock FROM products WHERE business_id = ? AND stock <= 5', [businessId]),
  ]);

  res.json({ totalProducts, totalCategories, totalOrders, totalUsers, totalRevenue, pendingOrders, lowStock });
}

export const uploadImage = handleImageUpload;
