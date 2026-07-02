import pool from '../config/db.js';
import { getEffectiveAttributesForCategory, getMergedAttributesForCategory } from '../utils/categoryAttributes.js';

async function assertCategoryOwnership(categoryId, businessId) {
  const [rows] = await pool.query('SELECT id FROM categories WHERE id = ? AND business_id = ?', [categoryId, businessId]);
  return rows.length > 0;
}

async function assertAttributeOwnership(attributeId, businessId) {
  const [rows] = await pool.query('SELECT id, category_id FROM category_attributes WHERE id = ? AND business_id = ?', [attributeId, businessId]);
  return rows[0] || null;
}

export async function listForCategory(req, res) {
  const { id } = req.params;
  if (!(await assertCategoryOwnership(id, req.business.id))) {
    return res.status(404).json({ error: 'Category not found' });
  }

  if (req.query.merged) {
    return res.json(await getMergedAttributesForCategory(req.business.id, id));
  }
  if (req.query.effective) {
    return res.json(await getEffectiveAttributesForCategory(req.business.id, id));
  }

  const [attributes] = await pool.query(
    'SELECT id, name FROM category_attributes WHERE category_id = ? ORDER BY sort_order, id',
    [id]
  );
  if (attributes.length === 0) return res.json([]);

  const [options] = await pool.query(
    `SELECT id, attribute_id, value FROM category_attribute_options WHERE attribute_id IN (${attributes.map(() => '?').join(',')}) ORDER BY sort_order, id`,
    attributes.map((a) => a.id)
  );

  res.json(
    attributes.map((attr) => ({
      id: attr.id,
      name: attr.name,
      options: options.filter((o) => o.attribute_id === attr.id).map((o) => ({ id: o.id, value: o.value })),
    }))
  );
}

export async function createAttribute(req, res) {
  const { id } = req.params;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!(await assertCategoryOwnership(id, req.business.id))) {
    return res.status(404).json({ error: 'Category not found' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO category_attributes (business_id, category_id, name) VALUES (?, ?, ?)',
      [req.business.id, id, name.trim()]
    );
    res.status(201).json({ id: result.insertId, name: name.trim(), options: [] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That filter already exists on this category' });
    throw err;
  }
}

export async function renameAttribute(req, res) {
  const { attrId } = req.params;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const attribute = await assertAttributeOwnership(attrId, req.business.id);
  if (!attribute) return res.status(404).json({ error: 'Filter not found' });

  try {
    await pool.query('UPDATE category_attributes SET name = ? WHERE id = ?', [name.trim(), attrId]);
    res.json({ message: 'Filter updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That filter name already exists on this category' });
    throw err;
  }
}

export async function deleteAttribute(req, res) {
  const { attrId } = req.params;
  const attribute = await assertAttributeOwnership(attrId, req.business.id);
  if (!attribute) return res.status(404).json({ error: 'Filter not found' });

  await pool.query('DELETE FROM category_attributes WHERE id = ?', [attrId]);
  res.json({ message: 'Filter deleted' });
}

export async function addOption(req, res) {
  const { attrId } = req.params;
  const { value } = req.body;
  if (!value?.trim()) return res.status(400).json({ error: 'value is required' });
  const attribute = await assertAttributeOwnership(attrId, req.business.id);
  if (!attribute) return res.status(404).json({ error: 'Filter not found' });

  try {
    const [result] = await pool.query(
      'INSERT INTO category_attribute_options (attribute_id, value) VALUES (?, ?)',
      [attrId, value.trim()]
    );
    res.status(201).json({ id: result.insertId, value: value.trim() });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That option already exists' });
    throw err;
  }
}

export async function renameOption(req, res) {
  const { optId } = req.params;
  const { value } = req.body;
  if (!value?.trim()) return res.status(400).json({ error: 'value is required' });

  const [rows] = await pool.query(
    `SELECT o.id FROM category_attribute_options o
     JOIN category_attributes a ON a.id = o.attribute_id
     WHERE o.id = ? AND a.business_id = ?`,
    [optId, req.business.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Option not found' });

  try {
    await pool.query('UPDATE category_attribute_options SET value = ? WHERE id = ?', [value.trim(), optId]);
    res.json({ message: 'Option updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That option already exists' });
    throw err;
  }
}

export async function deleteOption(req, res) {
  const { optId } = req.params;
  const [rows] = await pool.query(
    `SELECT o.id FROM category_attribute_options o
     JOIN category_attributes a ON a.id = o.attribute_id
     WHERE o.id = ? AND a.business_id = ?`,
    [optId, req.business.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Option not found' });

  await pool.query('DELETE FROM category_attribute_options WHERE id = ?', [optId]);
  res.json({ message: 'Option deleted' });
}