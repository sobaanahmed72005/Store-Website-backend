import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { escapeHtml } from '../utils/emailTemplate.js';

async function attachAttributeOptionIds(rows) {
  if (rows.length === 0) return rows;
  const [links] = await pool.query(
    `SELECT pav.product_id, pav.option_id, o.value, a.name AS attribute_name
     FROM product_attribute_values pav
     JOIN category_attribute_options o ON o.id = pav.option_id
     JOIN category_attributes a ON a.id = o.attribute_id
     WHERE pav.product_id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id)
  );
  return rows.map((row) => {
    const rowLinks = links.filter((l) => l.product_id === row.id);
    return {
      ...row,
      attribute_option_ids: rowLinks.map((l) => l.option_id),
      specifications: rowLinks.map((l) => ({ attribute: l.attribute_name, value: l.value })),
    };
  });
}

async function attachGalleryImages(rows) {
  if (rows.length === 0) return rows;
  const [images] = await pool.query(
    `SELECT product_id, image FROM product_images WHERE product_id IN (${rows.map(() => '?').join(',')}) ORDER BY sort_order, id`,
    rows.map((r) => r.id)
  );
  return rows.map((row) => ({
    ...row,
    images: images.filter((i) => i.product_id === row.id).map((i) => i.image),
  }));
}

async function attachReviewStats(rows) {
  if (rows.length === 0) return rows;
  const [stats] = await pool.query(
    `SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
     FROM product_reviews WHERE product_id IN (${rows.map(() => '?').join(',')}) AND status = 'approved' GROUP BY product_id`,
    rows.map((r) => r.id)
  );
  return rows.map((row) => {
    const stat = stats.find((s) => s.product_id === row.id);
    return {
      ...row,
      rating: stat ? Math.round(Number(stat.avg_rating)) : 0,
      review_count: stat ? Number(stat.review_count) : 0,
    };
  });
}

async function attachExtras(rows) {
  return attachReviewStats(await attachGalleryImages(await attachAttributeOptionIds(rows)));
}

async function setProductAttributeOptions(connection, productId, optionIds) {
  await connection.query('DELETE FROM product_attribute_values WHERE product_id = ?', [productId]);
  if (!optionIds?.length) return;
  const values = optionIds.map((optionId) => [productId, optionId]);
  await connection.query('INSERT INTO product_attribute_values (product_id, option_id) VALUES ?', [values]);
}

function validateSalePrice(is_on_sale, discount_price, price) {
  if (!is_on_sale) return null;
  const discount = Number(discount_price);
  if (discount_price == null || !Number.isFinite(discount) || discount <= 0) {
    return 'A valid sale price is required when On Sale is enabled';
  }
  if (discount >= Number(price)) {
    return 'Sale price must be less than the regular price';
  }
  return null;
}

async function setProductImages(connection, productId, images) {
  await connection.query('DELETE FROM product_images WHERE product_id = ?', [productId]);
  if (!images?.length) return;
  const values = images.map((image, index) => [productId, image, index]);
  await connection.query('INSERT INTO product_images (product_id, image, sort_order) VALUES ?', [values]);
}

// A parent category page should show products from that category AND all of its subcategories
// (any nesting depth), not just products assigned directly to it.
async function resolveCategoryAndDescendantIds(businessId, slug) {
  const [matchRows] = await pool.query(
    'SELECT id FROM categories WHERE business_id = ? AND slug = ?',
    [businessId, slug]
  );
  if (matchRows.length === 0) return [];

  const [allCategories] = await pool.query(
    'SELECT id, parent_id FROM categories WHERE business_id = ?',
    [businessId]
  );

  const ids = new Set([matchRows[0].id]);
  let added = true;
  while (added) {
    added = false;
    for (const cat of allCategories) {
      if (cat.parent_id != null && ids.has(cat.parent_id) && !ids.has(cat.id)) {
        ids.add(cat.id);
        added = true;
      }
    }
  }
  return [...ids];
}

export async function getProducts(req, res) {
  const { category, search, featured, new_arrival, on_sale } = req.query;
  let sql = 'SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id';
  const params = [req.business.id];
  const where = ['p.business_id = ?'];
  if (category) {
    const categoryIds = await resolveCategoryAndDescendantIds(req.business.id, category);
    if (categoryIds.length === 0) return res.json([]);
    where.push(`p.category_id IN (${categoryIds.map(() => '?').join(',')})`);
    params.push(...categoryIds);
  }
  if (search) {
    where.push('(p.name LIKE ? OR p.brand LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (featured) where.push('p.is_featured = 1');
  if (new_arrival) where.push('p.is_new_arrival = 1');
  if (on_sale) where.push('p.is_on_sale = 1');
  sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY p.created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json(await attachExtras(rows));
}

export async function getProductById(req, res) {
  const [rows] = await pool.query(
    'SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.business_id = ? AND p.id = ?',
    [req.business.id, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
  const [withExtras] = await attachExtras(rows);
  res.json(withExtras);
}

export async function getProductBySlug(req, res) {
  const [rows] = await pool.query(
    'SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.business_id = ? AND p.slug = ?',
    [req.business.id, req.params.slug]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
  const [withExtras] = await attachExtras(rows);
  res.json(withExtras);
}

export async function createProduct(req, res) {
  const {
    category_id, name, slug, brand, description, price, discount_price, stock, image,
    is_featured, is_new_arrival, is_on_sale, attribute_option_ids, images,
  } = req.body;
  if (!name || !slug || price == null) {
    return res.status(400).json({ error: 'name, slug and price are required' });
  }

  const saleError = validateSalePrice(is_on_sale, discount_price, price);
  if (saleError) return res.status(400).json({ error: saleError });

  if (category_id) {
    const [catRows] = await pool.query('SELECT id FROM categories WHERE id = ? AND business_id = ?', [category_id, req.business.id]);
    if (catRows.length === 0) return res.status(400).json({ error: 'Invalid category' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO products (business_id, category_id, name, slug, brand, description, price, discount_price, stock, image, is_featured, is_new_arrival, is_on_sale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.business.id, category_id || null, name, slug, brand ?? null, description ?? null, price,
        discount_price ?? null, stock ?? 0, image ?? null,
        Number(Boolean(is_featured)), Number(Boolean(is_new_arrival)), Number(Boolean(is_on_sale)),
      ]
    );
    await setProductAttributeOptions(connection, result.insertId, attribute_option_ids);
    await setProductImages(connection, result.insertId, images);
    await connection.commit();
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A product with this name/slug already exists' });
    throw err;
  } finally {
    connection.release();
  }
}

async function notifyBackInStock(businessId, productId) {
  const [rows] = await pool.query(
    `SELECT u.email, u.name, p.name AS product_name, p.slug AS product_slug
     FROM wishlist_items w
     JOIN users u ON u.id = w.user_id
     JOIN products p ON p.id = w.product_id
     WHERE w.business_id = ? AND w.product_id = ?`,
    [businessId, productId]
  );
  for (const row of rows) {
    sendMail({
      to: row.email,
      subject: `${row.product_name} is back in stock!`,
      html: `<p>Hi ${escapeHtml(row.name)},</p><p>Good news — <strong>${escapeHtml(row.product_name)}</strong>, an item on your wishlist, is back in stock. Grab it before it sells out again!</p>`,
    });
  }
}

export async function updateProduct(req, res) {
  const {
    category_id, name, slug, brand, description, price, discount_price, stock, image,
    is_featured, is_new_arrival, is_on_sale, attribute_option_ids, images,
  } = req.body;

  if (!name || !slug || price == null) {
    return res.status(400).json({ error: 'name, slug and price are required' });
  }

  const [existingRows] = await pool.query('SELECT stock FROM products WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (existingRows.length === 0) return res.status(404).json({ error: 'Product not found' });
  const previousStock = existingRows[0].stock;

  const saleError = validateSalePrice(is_on_sale, discount_price, price);
  if (saleError) return res.status(400).json({ error: saleError });

  if (category_id) {
    const [catRows] = await pool.query('SELECT id FROM categories WHERE id = ? AND business_id = ?', [category_id, req.business.id]);
    if (catRows.length === 0) return res.status(400).json({ error: 'Invalid category' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE products SET category_id = ?, name = ?, slug = ?, brand = ?, description = ?, price = ?,
       discount_price = ?, stock = ?, image = ?, is_featured = ?, is_new_arrival = ?, is_on_sale = ? WHERE id = ? AND business_id = ?`,
      [
        category_id || null, name, slug, brand ?? null, description ?? null, price,
        discount_price ?? null, stock ?? 0, image ?? null,
        Number(Boolean(is_featured)), Number(Boolean(is_new_arrival)), Number(Boolean(is_on_sale)),
        req.params.id, req.business.id,
      ]
    );
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Product not found' });
    }
    await setProductAttributeOptions(connection, req.params.id, attribute_option_ids);
    await setProductImages(connection, req.params.id, images);
    await connection.commit();
    res.json({ message: 'Product updated' });
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A product with this name/slug already exists' });
    throw err;
  } finally {
    connection.release();
  }

  const newStock = Number(stock ?? 0);
  if (previousStock <= 0 && newStock > 0) {
    notifyBackInStock(req.business.id, req.params.id);
  }
}

export async function deleteProduct(req, res) {
  const [result] = await pool.query('DELETE FROM products WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ message: 'Product deleted' });
}

export async function bulkSale(req, res) {
  const { scope, productIds, categoryIds, action, discountType, value } = req.body;

  let where = 'business_id = ?';
  let params = [req.business.id];

  if (scope === 'products') {
    if (!productIds?.length) return res.status(400).json({ error: 'productIds is required for this scope' });
    where += ` AND id IN (${productIds.map(() => '?').join(',')})`;
    params = [req.business.id, ...productIds];
  } else if (scope === 'categories') {
    if (!categoryIds?.length) return res.status(400).json({ error: 'categoryIds is required for this scope' });
    const [catRows] = await pool.query(
      `SELECT id FROM categories WHERE business_id = ? AND (id IN (${categoryIds.map(() => '?').join(',')}) OR parent_id IN (${categoryIds.map(() => '?').join(',')}))`,
      [req.business.id, ...categoryIds, ...categoryIds]
    );
    const allCategoryIds = catRows.map((r) => r.id);
    if (allCategoryIds.length === 0) return res.json({ message: 'No matching categories', updated: 0 });
    where += ` AND category_id IN (${allCategoryIds.map(() => '?').join(',')})`;
    params = [req.business.id, ...allCategoryIds];
  } else if (scope === 'all') {
    // where/params already scoped to business_id only
  } else {
    return res.status(400).json({ error: 'Invalid scope' });
  }

  if (action === 'clear') {
    const [result] = await pool.query(`UPDATE products SET is_on_sale = 0, discount_price = NULL WHERE ${where}`, params);
    return res.json({ message: 'Sale cleared', updated: result.affectedRows });
  }

  if (action !== 'apply') return res.status(400).json({ error: 'Invalid action' });
  if (!discountType || value == null) return res.status(400).json({ error: 'discountType and value are required' });

  if (discountType === 'percent') {
    const pct = Number(value);
    if (pct <= 0 || pct >= 100) return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
    const [result] = await pool.query(
      `UPDATE products SET discount_price = ROUND(price * (1 - ? / 100), 2), is_on_sale = 1 WHERE ${where}`,
      [pct, ...params]
    );
    return res.json({ message: 'Sale applied', updated: result.affectedRows });
  }

  if (discountType === 'fixed') {
    const fixedPrice = Number(value);
    if (fixedPrice <= 0) return res.status(400).json({ error: 'Sale price must be greater than 0' });
    const [result] = await pool.query(
      `UPDATE products SET discount_price = ?, is_on_sale = 1 WHERE ${where} AND price > ?`,
      [fixedPrice, ...params, fixedPrice]
    );
    return res.json({ message: 'Sale applied', updated: result.affectedRows });
  }

  res.status(400).json({ error: 'Invalid discountType' });
}
