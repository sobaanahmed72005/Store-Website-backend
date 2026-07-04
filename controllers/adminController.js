import pool from '../config/db.js';
import { handleImageUpload } from '../utils/uploadHandler.js';

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

export const uploadImage = handleImageUpload;
