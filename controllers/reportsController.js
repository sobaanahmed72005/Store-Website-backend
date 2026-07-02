import pool from '../config/db.js';

const REVENUE_STATUSES = "status NOT IN ('cancelled', 'returned')";

// mysql2 returns DECIMAL/SUM results as strings to avoid float precision loss;
// coerce the numeric fields the frontend charts (Recharts needs real numbers).
function numify(row, keys) {
  const out = { ...row };
  for (const key of keys) out[key] = Number(out[key]);
  return out;
}

function toDateStr(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function getRevenueTrend(req, res) {
  const businessId = req.business.id;
  const period = req.query.period === '12m' ? '12m' : req.query.period === '7d' ? '7d' : '30d';

  if (period === '12m') {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS bucket, COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders
       FROM orders
       WHERE business_id = ? AND ${REVENUE_STATUSES}
         AND created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 11 MONTH)
       GROUP BY bucket`,
      [businessId]
    );
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    const result = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const bucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const found = byBucket.get(bucket);
      result.push({ bucket, revenue: Number(found?.revenue || 0), orders: found?.orders || 0 });
    }
    return res.json(result);
  }

  const days = period === '7d' ? 7 : 30;
  const [rows] = await pool.query(
    `SELECT DATE(created_at) AS bucket, COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders
     FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES} AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY bucket`,
    [businessId, days - 1]
  );
  const byBucket = new Map(rows.map((r) => [toDateStr(r.bucket), r]));
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const bucket = toDateStr(d);
    const found = byBucket.get(bucket);
    result.push({ bucket, revenue: Number(found?.revenue || 0), orders: found?.orders || 0 });
  }
  res.json(result);
}

export async function getRevenueSummary(req, res) {
  const businessId = req.business.id;
  const [[week]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES} AND YEARWEEK(created_at, 1) = YEARWEEK(NOW(), 1)`,
    [businessId]
  );
  const [[month]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES} AND YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())`,
    [businessId]
  );
  const [[year]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES} AND YEAR(created_at) = YEAR(NOW())`,
    [businessId]
  );
  const [[allTime]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES}`,
    [businessId]
  );
  res.json({
    week: numify(week, ['revenue']),
    month: numify(month, ['revenue']),
    year: numify(year, ['revenue']),
    allTime: numify(allTime, ['revenue']),
  });
}

export async function getTopProducts(req, res) {
  const businessId = req.business.id;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const orderCol = req.query.by === 'quantity' ? 'totalQuantity' : 'totalRevenue';
  const [rows] = await pool.query(
    `SELECT oi.product_ref, oi.product_name,
            SUM(oi.quantity) AS totalQuantity,
            SUM(oi.quantity * oi.price) AS totalRevenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.business_id = ? AND o.${REVENUE_STATUSES}
     GROUP BY oi.product_ref, oi.product_name
     ORDER BY ${orderCol} DESC
     LIMIT ?`,
    [businessId, limit]
  );
  res.json(rows.map((r) => numify(r, ['totalQuantity', 'totalRevenue'])));
}

export async function getBottomProducts(req, res) {
  const businessId = req.business.id;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const [rows] = await pool.query(
    `SELECT p.id, p.name,
            COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'returned') THEN oi.quantity END), 0) AS totalQuantity,
            COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'returned') THEN oi.quantity * oi.price END), 0) AS totalRevenue
     FROM products p
     LEFT JOIN order_items oi ON oi.product_ref = CAST(p.id AS CHAR)
     LEFT JOIN orders o ON o.id = oi.order_id AND o.business_id = ?
     WHERE p.business_id = ?
     GROUP BY p.id, p.name
     ORDER BY totalQuantity ASC
     LIMIT ?`,
    [businessId, businessId, limit]
  );
  res.json(rows.map((r) => numify(r, ['totalQuantity', 'totalRevenue'])));
}

export async function getSalesByCity(req, res) {
  const businessId = req.business.id;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(shipping_city), ''), 'Unknown') AS city,
            COALESCE(SUM(total_amount), 0) AS revenue,
            COUNT(*) AS orders
     FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES}
     GROUP BY city
     ORDER BY revenue DESC
     LIMIT ?`,
    [businessId, limit]
  );
  res.json(rows.map((r) => numify(r, ['revenue', 'orders'])));
}

export async function getOrderStatusBreakdown(req, res) {
  const businessId = req.business.id;
  const [rows] = await pool.query(
    `SELECT status, COUNT(*) AS orders FROM orders WHERE business_id = ? GROUP BY status`,
    [businessId]
  );
  res.json(rows);
}

export async function getPaymentMethodBreakdown(req, res) {
  const businessId = req.business.id;
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(payment_method, ''), 'unknown') AS method,
            COUNT(*) AS orders,
            COALESCE(SUM(total_amount), 0) AS revenue
     FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES}
     GROUP BY method
     ORDER BY revenue DESC`,
    [businessId]
  );
  res.json(rows.map((r) => numify(r, ['revenue', 'orders'])));
}

const HISTOGRAM_BUCKETS = ['0-5k', '5k-10k', '10k-20k', '20k-50k', '50k+'];

export async function getOrderValueHistogram(req, res) {
  const businessId = req.business.id;
  const [rows] = await pool.query(
    `SELECT
        CASE
          WHEN total_amount < 5000  THEN '0-5k'
          WHEN total_amount < 10000 THEN '5k-10k'
          WHEN total_amount < 20000 THEN '10k-20k'
          WHEN total_amount < 50000 THEN '20k-50k'
          ELSE '50k+'
        END AS bucket,
        COUNT(*) AS orders
     FROM orders
     WHERE business_id = ? AND ${REVENUE_STATUSES}
     GROUP BY bucket`,
    [businessId]
  );
  const byBucket = new Map(rows.map((r) => [r.bucket, r.orders]));
  res.json(HISTOGRAM_BUCKETS.map((bucket) => ({ bucket, orders: byBucket.get(bucket) || 0 })));
}

export async function getSaleSplit(req, res) {
  const businessId = req.business.id;
  const [[row]] = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN oi.is_sale_price = 1 THEN oi.quantity * oi.price END), 0) AS saleRevenue,
        COALESCE(SUM(CASE WHEN oi.is_sale_price = 0 THEN oi.quantity * oi.price END), 0) AS regularRevenue,
        COALESCE(SUM(CASE WHEN oi.is_sale_price IS NULL THEN oi.quantity * oi.price END), 0) AS unknownRevenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.business_id = ? AND o.${REVENUE_STATUSES}`,
    [businessId]
  );
  res.json(numify(row, ['saleRevenue', 'regularRevenue', 'unknownRevenue']));
}
