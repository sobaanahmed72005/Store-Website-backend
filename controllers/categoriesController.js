import pool from '../config/db.js';

async function getAttributesForCategory(categoryId) {
  const [attributes] = await pool.query(
    'SELECT id, name FROM category_attributes WHERE category_id = ? ORDER BY sort_order, id',
    [categoryId]
  );
  if (attributes.length === 0) return [];

  const [options] = await pool.query(
    `SELECT id, attribute_id, value FROM category_attribute_options WHERE attribute_id IN (${attributes.map(() => '?').join(',')}) ORDER BY sort_order, id`,
    attributes.map((a) => a.id)
  );

  return attributes.map((attr) => ({
    id: attr.id,
    name: attr.name,
    options: options.filter((o) => o.attribute_id === attr.id).map((o) => ({ id: o.id, value: o.value })),
  }));
}

export async function getCategories(req, res) {
  const [rows] = await pool.query('SELECT * FROM categories WHERE business_id = ? ORDER BY sort_order, name', [req.business.id]);
  res.json(rows);
}

export async function getCategoryTree(req, res) {
  const [rows] = await pool.query('SELECT * FROM categories WHERE business_id = ? ORDER BY sort_order, name', [req.business.id]);
  const byId = new Map(rows.map((row) => [row.id, { ...row, subcategories: [] }]));
  const tree = [];
  for (const row of byId.values()) {
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id).subcategories.push(row);
    } else if (!row.parent_id) {
      tree.push(row);
    }
  }
  res.json(tree);
}

export async function getCategoryBySlug(req, res) {
  const [rows] = await pool.query('SELECT * FROM categories WHERE business_id = ? AND slug = ?', [req.business.id, req.params.slug]);
  if (rows.length === 0) return res.status(404).json({ error: 'Category not found' });
  const category = rows[0];
  const [subcategories] = await pool.query('SELECT * FROM categories WHERE business_id = ? AND parent_id = ? ORDER BY sort_order, name', [
    req.business.id,
    category.id,
  ]);
  const attributes = await getAttributesForCategory(category.id);
  res.json({ ...category, subcategories, attributes });
}

export async function createCategory(req, res) {
  const { name, slug, image, description, parent_id, sort_order, show_in_nav, show_in_icons } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });

  if (parent_id) {
    const [parentRows] = await pool.query('SELECT id FROM categories WHERE id = ? AND business_id = ?', [parent_id, req.business.id]);
    if (parentRows.length === 0) return res.status(400).json({ error: 'Invalid parent category' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO categories (business_id, name, slug, image, description, parent_id, sort_order, show_in_nav, show_in_icons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        req.business.id,
        name,
        slug,
        image ?? null,
        description ?? null,
        parent_id || null,
        sort_order ?? 0,
        show_in_nav === undefined ? 1 : Number(Boolean(show_in_nav)),
        show_in_icons === undefined ? 1 : Number(Boolean(show_in_icons)),
      ]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A category with this name/slug already exists' });
    throw err;
  }
}

export async function updateCategory(req, res) {
  const { name, slug, image, description, parent_id, sort_order, show_in_nav, show_in_icons } = req.body;

  if (parent_id) {
    const [parentRows] = await pool.query('SELECT id FROM categories WHERE id = ? AND business_id = ?', [parent_id, req.business.id]);
    if (parentRows.length === 0) return res.status(400).json({ error: 'Invalid parent category' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE categories SET name = ?, slug = ?, image = ?, description = ?, parent_id = ?, sort_order = ?, show_in_nav = ?, show_in_icons = ? WHERE id = ? AND business_id = ?',
      [
        name,
        slug,
        image ?? null,
        description ?? null,
        parent_id || null,
        sort_order ?? 0,
        show_in_nav === undefined ? 1 : Number(Boolean(show_in_nav)),
        show_in_icons === undefined ? 1 : Number(Boolean(show_in_icons)),
        req.params.id,
        req.business.id,
      ]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ message: 'Category updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A category with this name/slug already exists' });
    throw err;
  }
}

export async function deleteCategory(req, res) {
  const [result] = await pool.query('DELETE FROM categories WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ message: 'Category deleted' });
}
