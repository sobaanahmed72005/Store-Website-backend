import pool from '../config/db.js';

export async function getAncestorChainIds(businessId, categoryId) {
  const [rows] = await pool.query('SELECT id, parent_id FROM categories WHERE business_id = ?', [businessId]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chain = [];
  const visited = new Set();
  let current = Number(categoryId);
  while (current != null && byId.has(current) && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = byId.get(current).parent_id;
  }
  return chain;
}

// A category's own attributes only, no inherited ones — used wherever the caller wants exactly
// what was defined directly on this category (e.g. the category-admin editor), as opposed to
// getEffectiveAttributesForCategory's inheritance-aware chain below.
export async function getOwnAttributesForCategory(businessId, categoryId) {
  const [attributes] = await pool.query(
    'SELECT id, name FROM category_attributes WHERE business_id = ? AND category_id = ? ORDER BY sort_order, id',
    [businessId, categoryId]
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

// The category itself plus every descendant at any depth — mirrors the same walk used to decide
// which products appear on a category page (resolveCategoryAndDescendantIds in productsController),
// so "what filters can I show" always matches "what products can they apply to".
export async function getDescendantChainIds(businessId, categoryId) {
  const [rows] = await pool.query('SELECT id, parent_id FROM categories WHERE business_id = ?', [businessId]);
  const ids = new Set([Number(categoryId)]);
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) {
      if (row.parent_id != null && ids.has(row.parent_id) && !ids.has(row.id)) {
        ids.add(row.id);
        added = true;
      }
    }
  }
  return [...ids];
}

async function getFlatAttributesForCategoryIds(businessId, categoryIds, { orderByChain } = {}) {
  if (categoryIds.length === 0) return [];

  const [attributes] = await pool.query(
    `SELECT id, name, category_id, sort_order FROM category_attributes
     WHERE business_id = ? AND category_id IN (${categoryIds.map(() => '?').join(',')})`,
    [businessId, ...categoryIds]
  );
  if (attributes.length === 0) return [];

  if (orderByChain) {
    const chainIndex = new Map(categoryIds.map((id, i) => [id, i]));
    attributes.sort(
      (a, b) =>
        chainIndex.get(a.category_id) - chainIndex.get(b.category_id) ||
        a.sort_order - b.sort_order ||
        a.id - b.id
    );
  } else {
    attributes.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  const [options] = await pool.query(
    `SELECT id, attribute_id, value FROM category_attribute_options
     WHERE attribute_id IN (${attributes.map(() => '?').join(',')}) ORDER BY sort_order, id`,
    attributes.map((a) => a.id)
  );

  return attributes.map((attr) => ({
    id: attr.id,
    name: attr.name,
    category_id: attr.category_id,
    options: options.filter((o) => o.attribute_id === attr.id).map((o) => ({ id: o.id, value: o.value })),
  }));
}

// Folds attributes sharing a name into a single entry, and options sharing a value into a single
// option carrying every real option id that means that value — so selecting/tagging it applies
// everywhere that value exists, instead of showing (or requiring) duplicate filter rows.
function mergeAttributesByNameAndValue(flat) {
  const groups = new Map();
  for (const attr of flat) {
    const key = attr.name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { id: attr.id, name: attr.name, optionsByValue: new Map() });
    const group = groups.get(key);
    for (const opt of attr.options) {
      const valueKey = opt.value.trim().toLowerCase();
      if (!group.optionsByValue.has(valueKey)) group.optionsByValue.set(valueKey, { value: opt.value, ids: [] });
      group.optionsByValue.get(valueKey).ids.push(opt.id);
    }
  }
  return [...groups.values()].map((group) => ({
    id: group.id,
    name: group.name,
    options: [...group.optionsByValue.values()],
  }));
}

export async function getEffectiveAttributesForCategory(businessId, categoryId) {
  const chain = await getAncestorChainIds(businessId, categoryId);
  const flat = await getFlatAttributesForCategoryIds(businessId, chain, { orderByChain: true });
  return flat.map((attr) => ({ ...attr, inherited: attr.category_id !== Number(categoryId) }));
}

// Same as getEffectiveAttributesForCategory (own + inherited-from-ancestors attributes), but
// merged — used when tagging a product, where a value should apply everywhere it's meaningful.
export async function getMergedAttributesForCategory(businessId, categoryId) {
  const chain = await getAncestorChainIds(businessId, categoryId);
  const flat = await getFlatAttributesForCategoryIds(businessId, chain, { orderByChain: true });
  return mergeAttributesByNameAndValue(flat);
}

// The customer-facing counterpart: a category page's filter sidebar should offer every filter
// relevant to any product actually shown there — which includes products pulled in from
// subcategories (any depth) — merged so a "RAM" filter defined on two different subcategories
// shows up once, not twice.
export async function getMergedAttributesForCategoryAndDescendants(businessId, categoryId) {
  const ids = await getDescendantChainIds(businessId, categoryId);
  const flat = await getFlatAttributesForCategoryIds(businessId, ids);
  return mergeAttributesByNameAndValue(flat);
}
