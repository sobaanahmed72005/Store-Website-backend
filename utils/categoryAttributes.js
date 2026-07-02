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

export async function getEffectiveAttributesForCategory(businessId, categoryId) {
  const chain = await getAncestorChainIds(businessId, categoryId);
  if (chain.length === 0) return [];

  const [attributes] = await pool.query(
    `SELECT id, name, category_id, sort_order FROM category_attributes
     WHERE business_id = ? AND category_id IN (${chain.map(() => '?').join(',')})`,
    [businessId, ...chain]
  );
  if (attributes.length === 0) return [];

  const chainIndex = new Map(chain.map((id, i) => [id, i]));
  attributes.sort(
    (a, b) =>
      chainIndex.get(a.category_id) - chainIndex.get(b.category_id) ||
      a.sort_order - b.sort_order ||
      a.id - b.id
  );

  const [options] = await pool.query(
    `SELECT id, attribute_id, value FROM category_attribute_options
     WHERE attribute_id IN (${attributes.map(() => '?').join(',')}) ORDER BY sort_order, id`,
    attributes.map((a) => a.id)
  );

  return attributes.map((attr) => ({
    id: attr.id,
    name: attr.name,
    category_id: attr.category_id,
    inherited: attr.category_id !== Number(categoryId),
    options: options.filter((o) => o.attribute_id === attr.id).map((o) => ({ id: o.id, value: o.value })),
  }));
}

// Same as getEffectiveAttributesForCategory, but attributes sharing a name (own + inherited,
// e.g. "Resolution" defined both here and on a parent) are folded into a single entry, and
// options sharing a value are folded into a single option carrying every real option id that
// means that value — so tagging a product against it applies to every level at once.
export async function getMergedAttributesForCategory(businessId, categoryId) {
  const flat = await getEffectiveAttributesForCategory(businessId, categoryId);

  const groups = new Map();
  for (const attr of flat) {
    const key = attr.name.trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { id: attr.id, name: attr.name, inherited: attr.inherited, optionsByValue: new Map() });
    }
    const group = groups.get(key);
    if (!attr.inherited) group.inherited = false;
    for (const opt of attr.options) {
      const valueKey = opt.value.trim().toLowerCase();
      if (!group.optionsByValue.has(valueKey)) group.optionsByValue.set(valueKey, { value: opt.value, ids: [] });
      group.optionsByValue.get(valueKey).ids.push(opt.id);
    }
  }

  return [...groups.values()].map((group) => ({
    id: group.id,
    name: group.name,
    inherited: group.inherited,
    options: [...group.optionsByValue.values()],
  }));
}
