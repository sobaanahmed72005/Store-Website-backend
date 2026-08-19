import fs from 'fs/promises';
import path from 'path';
import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { escapeHtml } from '../utils/emailTemplate.js';
import { logAudit } from '../utils/auditLog.js';
import { logger } from '../utils/logger.js';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination.js';
import { uploadsDir, GENERATED_FILENAME_PATTERN } from '../middleware/upload.js';
import { isObjectStorageConfigured, getObjectBuffer } from '../utils/objectStorage.js';

const DATASET_CONTENT_TYPE_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

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
  const [overrides] = await pool.query(
    `SELECT product_id, attribute_name, value FROM product_spec_overrides WHERE product_id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id)
  );
  return rows.map((row) => {
    const rowLinks = links.filter((l) => l.product_id === row.id);
    const rowOverrides = overrides.filter((o) => o.product_id === row.id);
    const overrideByKey = new Map(rowOverrides.map((o) => [o.attribute_name.trim().toLowerCase(), o.value]));
    const seenAttributes = new Set();
    const specifications = [];
    for (const l of rowLinks) {
      const key = l.attribute_name.trim().toLowerCase();
      if (seenAttributes.has(key)) continue;
      seenAttributes.add(key);
      // An attribute with 2+ selected options has no single correct auto-derived value (it's a
      // variant dimension) — an explicit admin override always wins over the first-tag default.
      specifications.push({ attribute: l.attribute_name, value: overrideByKey.get(key) ?? l.value });
    }
    return {
      ...row,
      attribute_option_ids: rowLinks.map((l) => l.option_id),
      specifications,
      spec_overrides: rowOverrides.map((o) => ({ attribute_name: o.attribute_name, value: o.value })),
    };
  });
}

// Cheap has_variants flag for grid/listing pages — avoids joining the full variant+option shape
// (attachVariants below) across every row on a page that never needs anything but the boolean.
async function attachHasVariants(rows) {
  if (rows.length === 0) return rows;
  const [variantRows] = await pool.query(
    `SELECT DISTINCT product_id FROM product_variants WHERE product_id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id)
  );
  const withVariants = new Set(variantRows.map((r) => r.product_id));
  return rows.map((row) => ({ ...row, has_variants: withVariants.has(row.id) }));
}

// A variant's identity across saves is its exact set of option ids, not its DB row id — variants
// are wiped and reinserted whole on every product save (see setProductVariants), so a variant_id
// captured before a save would already be stale by the time anything read it back. Both variant
// key-spec resolution (setProductKeySpecs) and the reconciliation below key off this instead.
function optionKey(optionIds) {
  return [...optionIds].map(Number).sort((a, b) => a - b).join(',');
}

// Full variant detail for a single-product read — each variant labeled with its option values so
// the PDP can build a picker and match a selection without a second round-trip.
async function attachVariants(rows) {
  if (rows.length === 0) return rows;
  const [variants] = await pool.query(
    `SELECT id, product_id, price, discount_price, stock, description FROM product_variants WHERE product_id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id)
  );
  if (variants.length === 0) return rows.map((row) => ({ ...row, variants: [] }));
  const [options] = await pool.query(
    `SELECT pvo.variant_id, o.value, a.name AS attribute
     FROM product_variant_options pvo
     JOIN category_attribute_options o ON o.id = pvo.option_id
     JOIN category_attributes a ON a.id = o.attribute_id
     WHERE pvo.variant_id IN (${variants.map(() => '?').join(',')})`,
    variants.map((v) => v.id)
  );
  // Key specs scoped to one specific variant (product_specs.variant_id) — attachKeySpecs already
  // put the "all variants" ones (variant_id IS NULL) on the product's own key_specs/specifications;
  // these are the extra, variant-only facts, shown only once that exact variant is selected.
  const [variantSpecs] = await pool.query(
    `SELECT variant_id, label, value FROM product_specs WHERE variant_id IN (${variants.map(() => '?').join(',')}) ORDER BY sort_order, id`,
    variants.map((v) => v.id)
  );
  return rows.map((row) => ({
    ...row,
    variants: variants
      .filter((v) => v.product_id === row.id)
      .map((v) => ({
        id: v.id,
        price: v.price,
        discount_price: v.discount_price,
        stock: v.stock,
        description: v.description,
        options: options.filter((o) => o.variant_id === v.id).map((o) => ({ attribute: o.attribute, value: o.value })),
        key_specs: variantSpecs.filter((s) => s.variant_id === v.id).map((s) => ({ label: s.label, value: s.value })),
      })),
  }));
}

function variantEffectivePrice(variant) {
  return variant.discount_price != null && Number(variant.discount_price) < Number(variant.price)
    ? Number(variant.discount_price)
    : Number(variant.price);
}

// Free-form admin-typed spec rows (see product_specs in schema.sql) — merged into the same
// `specifications` list attachAttributeOptionIds already built, listed first since they're what
// the admin explicitly curated as highlights rather than incidental filter/variant metadata. Must
// run after attachAttributeOptionIds so `row.specifications` already exists to merge into.
async function attachKeySpecs(rows) {
  if (rows.length === 0) return rows;
  // variant_id IS NULL: this function only surfaces the "all variants" specs at the product level —
  // a spec scoped to one specific variant is attached to that variant instead, in attachVariants.
  const [specs] = await pool.query(
    `SELECT id, product_id, label, value FROM product_specs WHERE product_id IN (${rows.map(() => '?').join(',')}) AND variant_id IS NULL ORDER BY sort_order, id`,
    rows.map((r) => r.id)
  );
  return rows.map((row) => {
    const rowSpecs = specs.filter((s) => s.product_id === row.id);
    return {
      ...row,
      key_specs: rowSpecs.map((s) => ({ id: s.id, label: s.label, value: s.value })),
      specifications: [...rowSpecs.map((s) => ({ attribute: s.label, value: s.value })), ...(row.specifications || [])],
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
  return attachHasVariants(await attachReviewStats(await attachGalleryImages(await attachKeySpecs(await attachAttributeOptionIds(rows)))));
}

async function attachSingleProductExtras(rows) {
  return attachVariants(await attachExtras(rows));
}

async function setProductAttributeOptions(connection, productId, optionIds) {
  await connection.query('DELETE FROM product_attribute_values WHERE product_id = ?', [productId]);
  if (!optionIds?.length) return;
  // Deduped defensively — a repeated option_id here would hit product_attribute_values' unique
  // (product_id, option_id) constraint on the bulk insert below, and the callers' catch blocks
  // would misreport it as a duplicate product name/slug, which isn't what actually happened.
  const values = [...new Set(optionIds)].map((optionId) => [productId, optionId]);
  await connection.query('INSERT INTO product_attribute_values (product_id, option_id) VALUES ?', [values]);
}

// Same delete-then-reinsert pattern as setProductAttributeOptions/setProductImages. Each variant's
// price/stock must already be validated by the caller before the transaction opens. Returns the
// option-combo -> freshly-inserted-id map setProductKeySpecs needs to resolve a variant-scoped spec,
// since every variant just got a brand new id here regardless of what it was before this save.
async function setProductVariants(connection, businessId, productId, variants) {
  await connection.query('DELETE FROM product_variants WHERE product_id = ?', [productId]);
  const variantIdByOptionKey = new Map();
  if (!variants?.length) return variantIdByOptionKey;
  for (const v of variants) {
    const [result] = await connection.query(
      'INSERT INTO product_variants (business_id, product_id, price, discount_price, stock, description) VALUES (?, ?, ?, ?, ?, ?)',
      [businessId, productId, v.price, v.discount_price ?? null, v.stock ?? 0, v.description?.trim() || null]
    );
    if (v.option_ids?.length) {
      const values = v.option_ids.map((optionId) => [result.insertId, optionId]);
      await connection.query('INSERT INTO product_variant_options (variant_id, option_id) VALUES ?', [values]);
      variantIdByOptionKey.set(optionKey(v.option_ids), result.insertId);
    }
  }
  return variantIdByOptionKey;
}

function validateVariants(variants) {
  if (!variants?.length) return null;
  for (const v of variants) {
    const err = validatePriceAndStock(v.price, v.stock);
    if (err) return err;
    if (!v.option_ids?.length) return 'Each variant must have at least one selected option';
    if (v.discount_price != null) {
      const discount = Number(v.discount_price);
      if (!Number.isFinite(discount) || discount <= 0) {
        return 'Each variant sale price must be a positive number';
      }
      if (discount >= Number(v.price)) {
        return 'Each variant sale price must be less than its regular price';
      }
    }
  }
  return null;
}

function validatePriceAndStock(price, stock) {
  if (!Number.isFinite(Number(price)) || Number(price) < 0) {
    return 'price must be a non-negative number';
  }
  if (stock != null && (!Number.isFinite(Number(stock)) || Number(stock) < 0)) {
    return 'stock must be a non-negative number';
  }
  return null;
}

// Matches the standard watch/short/embed/share URL shapes and pulls out the 11-char video id.
// Everything downstream (createProduct/updateProduct) rebuilds a canonical
// https://www.youtube.com/watch?v=<id> from this id rather than ever storing/echoing the
// admin-supplied URL verbatim — so no attacker-controlled string (a "javascript:" URI, an open
// redirect, arbitrary query params) can end up in a link rendered on the storefront.
const YOUTUBE_URL_PATTERN = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractYoutubeId(url) {
  const match = typeof url === 'string' ? url.match(YOUTUBE_URL_PATTERN) : null;
  return match ? match[1] : null;
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

// specOverrides is a { [attributeName]: value } map from the admin form — only attributes the
// admin actually typed a value for get a row; a blank/missing entry falls back to the default
// first-tag specification value in attachAttributeOptionIds above.
async function setProductSpecOverrides(connection, productId, specOverrides) {
  await connection.query('DELETE FROM product_spec_overrides WHERE product_id = ?', [productId]);
  const entries = Object.entries(specOverrides || {}).filter(([, value]) => value != null && String(value).trim() !== '');
  if (entries.length === 0) return;
  const values = entries.map(([name, value]) => [productId, name, String(value).trim()]);
  await connection.query('INSERT INTO product_spec_overrides (product_id, attribute_name, value) VALUES ?', [values]);
}

// keySpecs is [{ label, value, variant_option_ids? }] from the admin form's free-form Key
// Specifications editor — completely separate from the category-attribute machinery above. A label
// with no value is a plain bullet point (e.g. "Waterproof") rather than a "Label: Value" pair —
// valid on its own, per validateKeySpecs below. A fully-blank row (an admin clicking "+ Add" and not
// filling it in) is the only thing this silently drops on its own account.
//
// variant_option_ids is the exact option_ids of one of the variants in this same save ("Applies
// to" dropdown; absent/empty means "All Variants"), resolved against variantIdByOptionKey (built by
// setProductVariants moments ago in the same transaction) rather than trusting a raw variant_id —
// variant rows are wiped and reinserted with fresh ids on every save, so a stale id would silently
// point at nothing. If the admin's chosen combination isn't among this save's variants (e.g. they
// removed it in the same edit), the row is dropped rather than silently widening it to "All
// Variants" — that would publish it somewhere the admin never chose.
async function setProductKeySpecs(connection, productId, keySpecs, variantIdByOptionKey) {
  await connection.query('DELETE FROM product_specs WHERE product_id = ?', [productId]);
  const entries = (keySpecs || [])
    .map((s) => ({
      label: String(s?.label ?? '').trim(),
      value: String(s?.value ?? '').trim(),
      variantOptionIds: s?.variant_option_ids,
    }))
    .filter((s) => s.label !== '')
    .filter((s) => !s.variantOptionIds?.length || variantIdByOptionKey.has(optionKey(s.variantOptionIds)));
  if (entries.length === 0) return;
  const values = entries.map((s, index) => [
    productId,
    s.variantOptionIds?.length ? variantIdByOptionKey.get(optionKey(s.variantOptionIds)) : null,
    s.label,
    s.value,
    index,
  ]);
  await connection.query('INSERT INTO product_specs (product_id, variant_id, label, value, sort_order) VALUES ?', [values]);
}

function validateKeySpecs(keySpecs) {
  if (!keySpecs?.length) return null;
  for (const s of keySpecs) {
    const label = String(s?.label ?? '').trim();
    const value = String(s?.value ?? '').trim();
    if (label === '' && value === '') continue; // fully-blank row, dropped silently by setProductKeySpecs
    // A value with no label has nowhere to attach — the label is the one required field, since
    // it's what a lone bullet point (no value) displays as (see attachKeySpecs/Product.jsx).
    if (label === '') return 'Each key specification needs at least a label';
    if (label.length > 100) return 'Each key specification label must be 100 characters or fewer';
    if (value.length > 255) return 'Each key specification value must be 255 characters or fewer';
  }
  return null;
}

// A parent category page should show products from that category AND all of its subcategories
// (any nesting depth), not just products assigned directly to it.
export async function resolveCategoryAndDescendantIds(businessId, slug) {
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

// Whitelisted, not built from the raw query value — sort is a client-controlled param, and
// interpolating it straight into ORDER BY would be a SQL injection hole. Price matches
// getEffectivePrice's logic on the frontend (utils/pricing.js): the discount price only counts
// while is_on_sale is actually on, not just because a discount_price happens to be set.
const SORT_CLAUSES = {
  newest: 'p.created_at DESC',
  price_asc: 'IF(p.is_on_sale = 1 AND p.discount_price IS NOT NULL, p.discount_price, p.price) ASC',
  price_desc: 'IF(p.is_on_sale = 1 AND p.discount_price IS NOT NULL, p.discount_price, p.price) DESC',
  name_asc: 'p.name ASC',
  name_desc: 'p.name DESC',
  // NULL (no reviews yet) sorts last here, same as MySQL's default NULL-ordering for DESC —
  // unrated products sink to the bottom instead of outranking genuinely well-reviewed ones.
  rating: 'rv.avg_rating DESC, p.created_at DESC',
};

export async function getProducts(req, res) {
  const { category, search, featured, new_arrival, on_sale, low_stock, brand, options, sort } = req.query;
  const { page, limit, offset } = parsePagination(req, 24);
  // The rating join only runs when actually sorting by rating — every other listing request
  // (the overwhelming majority) skips the extra join and aggregate entirely.
  const needsRatingJoin = sort === 'rating';
  let sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.parent_id AS category_parent_id FROM products p LEFT JOIN categories c ON p.category_id = c.id${
    needsRatingJoin
      ? " LEFT JOIN (SELECT product_id, AVG(rating) AS avg_rating FROM product_reviews WHERE status = 'approved' GROUP BY product_id) rv ON rv.product_id = p.id"
      : ''
  }`;
  const params = [req.business.id];
  const where = ['p.business_id = ?'];
  if (category) {
    const categoryIds = await resolveCategoryAndDescendantIds(req.business.id, category);
    if (categoryIds.length === 0) return res.json(buildPaginatedResponse('products', [], 0, page, limit));
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
  // Same threshold as the dashboard's "Low Stock" stat card (adminController.js) — kept in sync
  // so clicking through from that card shows exactly the products counted there.
  if (low_stock) where.push('p.stock <= 5');
  // Brand is plain text on the product, matched case-insensitively (the storefront's own filter
  // checkboxes are similarly deduped case-insensitively) — a comma-separated list is an OR (any
  // of the checked brands).
  if (brand) {
    const brandList = brand.split(',').map((b) => b.trim()).filter(Boolean);
    if (brandList.length > 0) {
      where.push(`LOWER(p.brand) IN (${brandList.map(() => '?').join(',')})`);
      params.push(...brandList.map((b) => b.toLowerCase()));
    }
  }
  // Selected category-attribute option ids, e.g. "3,7,9". Grouped by their real attribute_id
  // (looked up here, not trusted from the client) so the filter matches the sidebar's own
  // semantics: a product must have at least one selected option from EVERY attribute that has a
  // selection (AND across attributes), but only needs to match ANY one selected option within a
  // single attribute (OR within an attribute, e.g. "1080p" OR "2K").
  if (options) {
    const optionIds = [...new Set(options.split(',').map(Number).filter(Number.isInteger))];
    if (optionIds.length > 0) {
      const [optionRows] = await pool.query(
        `SELECT id, attribute_id FROM category_attribute_options WHERE id IN (${optionIds.map(() => '?').join(',')})`,
        optionIds
      );
      const groups = new Map();
      for (const row of optionRows) {
        if (!groups.has(row.attribute_id)) groups.set(row.attribute_id, []);
        groups.get(row.attribute_id).push(row.id);
      }
      for (const groupOptionIds of groups.values()) {
        where.push(
          `p.id IN (SELECT product_id FROM product_attribute_values WHERE option_id IN (${groupOptionIds.map(() => '?').join(',')}))`
        );
        params.push(...groupOptionIds);
      }
    }
  }
  const whereSql = ' WHERE ' + where.join(' AND ');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON p.category_id = c.id${whereSql}`,
    params
  );

  let orderBy = SORT_CLAUSES[sort];
  let extraParams = [];
  if (!orderBy && search) {
    orderBy = `(p.name LIKE ?) DESC, (p.name LIKE ?) DESC, (c.name LIKE ?) DESC, (p.brand LIKE ?) DESC, (p.description LIKE ?) DESC, p.created_at DESC`;
    extraParams = [`${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
  } else if (!orderBy) {
    orderBy = SORT_CLAUSES.newest;
  }

  sql += whereSql + ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  const [rows] = await pool.query(sql, [...params, ...extraParams, limit, offset]);
  res.json(buildPaginatedResponse('products', await attachExtras(rows), total, page, limit));
}

// Brand isn't a managed list anywhere — it's just a text field on each product — so admin
// autocomplete works off whatever values are already in use, deduped case-insensitively so
// "Dell" and "dell" (typed on different days) suggest as one entry instead of two.
export async function getProductBrands(req, res) {
  const [rows] = await pool.query(
    "SELECT DISTINCT brand FROM products WHERE business_id = ? AND brand IS NOT NULL AND brand != ''",
    [req.business.id]
  );
  const byKey = new Map();
  for (const { brand } of rows) {
    const key = brand.trim().toLowerCase();
    if (!byKey.has(key)) byKey.set(key, brand.trim());
  }
  res.json([...byKey.values()].sort((a, b) => a.localeCompare(b)));
}

export async function getProductSuggestions(req, res) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);

  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.slug, p.image, p.price, p.discount_price, p.is_on_sale, c.name AS category_name
     FROM products p LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.business_id = ? AND (p.name LIKE ? OR p.brand LIKE ? OR p.description LIKE ? OR c.name LIKE ?)
     ORDER BY (p.name LIKE ?) DESC, (p.name LIKE ?) DESC, (c.name LIKE ?) DESC, (p.brand LIKE ?) DESC, (p.description LIKE ?) DESC, p.name ASC
     LIMIT 8`,
    [
      req.business.id,
      `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`,
      `${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`
    ]
  );
  res.json(rows);
}

export async function getProductById(req, res) {
  const [rows] = await pool.query(
    'SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.business_id = ? AND p.id = ?',
    [req.business.id, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
  const [withExtras] = await attachSingleProductExtras(rows);
  res.json(withExtras);
}

export async function getProductBySlug(req, res) {
  const [rows] = await pool.query(
    'SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.business_id = ? AND p.slug = ?',
    [req.business.id, req.params.slug]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
  const [withExtras] = await attachSingleProductExtras(rows);
  res.json(withExtras);
}

// Proxies the dataset file back through this app instead of handing the customer a direct link to
// the CDN/object-storage bucket — the storefront's Dataset button hits this route, not
// product.dataset directly, so the click downloads the file (via Content-Disposition below) rather
// than navigating the browser to a bare object-storage URL in a new tab.
export async function downloadProductDataset(req, res) {
  const [rows] = await pool.query(
    'SELECT name, dataset FROM products WHERE business_id = ? AND slug = ?',
    [req.business.id, req.params.slug]
  );
  if (rows.length === 0 || !rows[0].dataset) return res.status(404).json({ error: 'Not found' });

  const { name, dataset } = rows[0];
  // dataset is stored as either a local `/uploads/<filename>` path or a full CDN URL (see
  // utils/uploadHandler.js) — only the filename itself (validated below) is ever used for a
  // disk/object-storage lookup, never the stored value verbatim.
  const filename = dataset.split('/').pop();
  if (!GENERATED_FILENAME_PATTERN.test(filename)) return res.status(404).json({ error: 'Not found' });

  const ext = filename.split('.').pop().toLowerCase();
  const downloadName = `${name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'dataset'}.${ext}`;

  let buffer;
  try {
    buffer = isObjectStorageConfigured
      ? await getObjectBuffer(`uploads/${filename}`)
      : await fs.readFile(path.join(uploadsDir, filename));
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }

  res.setHeader('Content-Type', DATASET_CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.end(buffer);
}

export async function createProduct(req, res) {
  const {
    category_id, name, slug, brand, description, price, discount_price, stock, image, video, dataset,
    content_image, content_image_caption, content_video_url, content_video_title, content_video_caption,
    is_featured, is_new_arrival, is_on_sale, attribute_option_ids, images, variants, spec_overrides, key_specs,
  } = req.body;
  if (!name || !slug || price == null) {
    return res.status(400).json({ error: 'name, slug and price are required' });
  }

  const variantError = validateVariants(variants);
  if (variantError) return res.status(400).json({ error: variantError });

  const keySpecsError = validateKeySpecs(key_specs);
  if (keySpecsError) return res.status(400).json({ error: keySpecsError });

  // Once a product has variants, the base row's price/stock are derived, not admin-entered:
  // price is the cheapest effective variant price (a truthful "starting from" figure for grid/
  // listing pages), stock is the sum across variants.
  const effectivePrice = variants?.length ? Math.min(...variants.map(variantEffectivePrice)) : price;
  const effectiveStock = variants?.length ? variants.reduce((sum, v) => sum + Number(v.stock || 0), 0) : stock;

  const priceStockError = validatePriceAndStock(effectivePrice, effectiveStock);
  if (priceStockError) return res.status(400).json({ error: priceStockError });

  const saleError = validateSalePrice(is_on_sale, discount_price, effectivePrice);
  if (saleError) return res.status(400).json({ error: saleError });

  let normalizedVideoUrl = null;
  if (content_video_url) {
    const videoId = extractYoutubeId(content_video_url);
    if (!videoId) return res.status(400).json({ error: 'Content video must be a valid YouTube URL' });
    normalizedVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (category_id) {
    const [catRows] = await pool.query('SELECT id FROM categories WHERE id = ? AND business_id = ?', [category_id, req.business.id]);
    if (catRows.length === 0) return res.status(400).json({ error: 'Invalid category' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO products (business_id, category_id, name, slug, brand, description, price, discount_price, stock, image, video, dataset, content_image, content_image_caption, content_video_url, content_video_title, content_video_caption, is_featured, is_new_arrival, is_on_sale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.business.id, category_id || null, name, slug, brand ?? null, description ?? null, effectivePrice,
        discount_price ?? null, effectiveStock ?? 0, image ?? null, video ?? null, dataset ?? null,
        content_image ?? null, content_image_caption ?? null,
        normalizedVideoUrl, content_video_title ?? null, content_video_caption ?? null,
        Number(Boolean(is_featured)), Number(Boolean(is_new_arrival)), Number(Boolean(is_on_sale)),
      ]
    );
    await setProductAttributeOptions(connection, result.insertId, attribute_option_ids);
    await setProductImages(connection, result.insertId, images);
    const variantIdByOptionKey = await setProductVariants(connection, req.business.id, result.insertId, variants);
    await setProductSpecOverrides(connection, result.insertId, spec_overrides);
    await setProductKeySpecs(connection, result.insertId, key_specs, variantIdByOptionKey);
    await connection.commit();
    res.status(201).json({ id: result.insertId });
    logAudit({ req, action: 'product.create', entityType: 'product', entityId: result.insertId, details: { name, price: effectivePrice, stock: effectiveStock ?? 0 } });
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

// A product is "effectively" on sale only when both the flag and a discount price are set —
// mirrors src/utils/pricing.js's getEffectivePrice on the frontend so both sides agree on
// what price the customer actually pays.
function getEffectivePrice({ price, discount_price, is_on_sale }) {
  const onSale = Boolean(is_on_sale) && discount_price != null;
  return onSale ? Number(discount_price) : Number(price);
}

async function notifyPriceDrop(businessId, productId, newPrice) {
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
      subject: `Price drop on ${row.product_name}!`,
      html: `<p>Hi ${escapeHtml(row.name)},</p><p>Good news — <strong>${escapeHtml(row.product_name)}</strong>, an item on your wishlist, just dropped in price to Rs.&nbsp;${Number(newPrice).toLocaleString()}. Grab it while the deal lasts!</p>`,
    });
  }
}

export async function updateProduct(req, res) {
  const {
    category_id, name, slug, brand, description, price, discount_price, stock, image, video, dataset,
    content_image, content_image_caption, content_video_url, content_video_title, content_video_caption,
    is_featured, is_new_arrival, is_on_sale, attribute_option_ids, images, variants, spec_overrides, key_specs,
  } = req.body;

  if (!name || !slug || price == null) {
    return res.status(400).json({ error: 'name, slug and price are required' });
  }

  const variantError = validateVariants(variants);
  if (variantError) return res.status(400).json({ error: variantError });

  const keySpecsError = validateKeySpecs(key_specs);
  if (keySpecsError) return res.status(400).json({ error: keySpecsError });

  const effectivePrice = variants?.length ? Math.min(...variants.map(variantEffectivePrice)) : price;
  const effectiveStock = variants?.length ? variants.reduce((sum, v) => sum + Number(v.stock || 0), 0) : stock;

  const [existingRows] = await pool.query(
    'SELECT price, stock, discount_price, is_on_sale FROM products WHERE id = ? AND business_id = ?',
    [req.params.id, req.business.id]
  );
  if (existingRows.length === 0) return res.status(404).json({ error: 'Product not found' });
  const previousStock = existingRows[0].stock;
  const previousPrice = existingRows[0].price;
  const previousEffectivePrice = getEffectivePrice(existingRows[0]);

  const priceStockError = validatePriceAndStock(effectivePrice, effectiveStock);
  if (priceStockError) return res.status(400).json({ error: priceStockError });

  const saleError = validateSalePrice(is_on_sale, discount_price, effectivePrice);
  if (saleError) return res.status(400).json({ error: saleError });

  let normalizedVideoUrl = null;
  if (content_video_url) {
    const videoId = extractYoutubeId(content_video_url);
    if (!videoId) return res.status(400).json({ error: 'Content video must be a valid YouTube URL' });
    normalizedVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (category_id) {
    const [catRows] = await pool.query('SELECT id FROM categories WHERE id = ? AND business_id = ?', [category_id, req.business.id]);
    if (catRows.length === 0) return res.status(400).json({ error: 'Invalid category' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE products SET category_id = ?, name = ?, slug = ?, brand = ?, description = ?, price = ?,
       discount_price = ?, stock = ?, image = ?, video = ?, dataset = ?, content_image = ?, content_image_caption = ?,
       content_video_url = ?, content_video_title = ?, content_video_caption = ?,
       is_featured = ?, is_new_arrival = ?, is_on_sale = ? WHERE id = ? AND business_id = ?`,
      [
        category_id || null, name, slug, brand ?? null, description ?? null, effectivePrice,
        discount_price ?? null, effectiveStock ?? 0, image ?? null, video ?? null, dataset ?? null,
        content_image ?? null, content_image_caption ?? null,
        normalizedVideoUrl, content_video_title ?? null, content_video_caption ?? null,
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
    const variantIdByOptionKey = await setProductVariants(connection, req.business.id, req.params.id, variants);
    await setProductSpecOverrides(connection, req.params.id, spec_overrides);
    await setProductKeySpecs(connection, req.params.id, key_specs, variantIdByOptionKey);
    await connection.commit();
    res.json({ message: 'Product updated' });
    logAudit({
      req, action: 'product.update', entityType: 'product', entityId: req.params.id,
      details: { name, price: { from: previousPrice, to: effectivePrice }, stock: { from: previousStock, to: effectiveStock ?? 0 } },
    });
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A product with this name/slug already exists' });
    throw err;
  } finally {
    connection.release();
  }

  const newStock = Number(effectiveStock ?? 0);
  if (previousStock <= 0 && newStock > 0) {
    // Best-effort wishlist notification — must not let a DB/mail hiccup here become an
    // unhandled rejection, which (Node >=15) crashes the whole process, not just this request.
    notifyBackInStock(req.business.id, req.params.id).catch((err) => {
      logger.error({ err, businessId: req.business.id, productId: req.params.id }, 'notifyBackInStock failed');
    });
  }

  const newEffectivePrice = getEffectivePrice({ price: effectivePrice, discount_price, is_on_sale });
  if (newEffectivePrice < previousEffectivePrice) {
    notifyPriceDrop(req.business.id, req.params.id, newEffectivePrice);
  }
}

export async function deleteProduct(req, res) {
  const [existing] = await pool.query('SELECT name FROM products WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Product not found' });

  await pool.query('DELETE FROM products WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  res.json({ message: 'Product deleted' });
  logAudit({ req, action: 'product.delete', entityType: 'product', entityId: req.params.id, details: { name: existing[0].name } });
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

  // Only ids are resolved up front — the price actually used for discount math is read later,
  // under FOR UPDATE, inside the same transaction that writes it. Reading price here instead
  // would let a concurrent product-price edit (or an overlapping bulkSale call) commit in
  // between this read and the write, silently basing the discount on a price that's already stale.
  const [idRows] = await pool.query(`SELECT id FROM products WHERE ${where}`, params);
  const matchedIds = idRows.map((p) => p.id);
  if (matchedIds.length === 0) {
    return res.json({ message: action === 'clear' ? 'Sale cleared' : 'Sale applied', updated: 0 });
  }

  if (action === 'clear') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`UPDATE products SET is_on_sale = 0, discount_price = NULL WHERE ${where}`, params);
      await connection.query(
        `UPDATE product_variants SET discount_price = NULL WHERE product_id IN (${matchedIds.map(() => '?').join(',')})`,
        matchedIds
      );
      await connection.commit();
      return res.json({ message: 'Sale cleared', updated: matchedIds.length });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  if (action !== 'apply') return res.status(400).json({ error: 'Invalid action' });
  if (!discountType || value == null) return res.status(400).json({ error: 'discountType and value are required' });

  let computeDiscount;
  if (discountType === 'percent') {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
    computeDiscount = (price) => Math.round(price * (1 - pct / 100) * 100) / 100;
  } else if (discountType === 'fixed') {
    const fixedPrice = Number(value);
    if (!Number.isFinite(fixedPrice) || fixedPrice <= 0) return res.status(400).json({ error: 'Sale price must be greater than 0' });
    computeDiscount = (price) => (price > fixedPrice ? fixedPrice : null);
  } else {
    return res.status(400).json({ error: 'Invalid discountType' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // FOR UPDATE locks these rows for the rest of the transaction — a concurrent updateProduct or
    // overlapping bulkSale call touching the same rows blocks until this commits, instead of each
    // computing a discount from a price the other is simultaneously changing.
    const [products] = await connection.query(`SELECT id, price FROM products WHERE ${where} FOR UPDATE`, params);
    const [variantRows] = await connection.query(
      `SELECT id, product_id, price FROM product_variants WHERE product_id IN (${matchedIds.map(() => '?').join(',')}) FOR UPDATE`,
      matchedIds
    );
    const variantsByProduct = new Map();
    for (const v of variantRows) {
      if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
      variantsByProduct.get(v.product_id).push(v);
    }

    // A product with variants shows a derived "starting from" price/sale badge on the storefront,
    // not an admin-entered one — writing discount_price only on the base row (as this used to do)
    // left that badge pointing at a sale price no actual variant honored. Every variant needs its
    // own discount applied too, with the base row's badge recomputed from the (now discounted)
    // per-variant prices, the same way create/update product does it.
    //
    // Built as one batched CASE-based UPDATE per table rather than one round-trip per row — with
    // "apply to all products" on a large catalog, N sequential awaited UPDATEs would hold these
    // FOR UPDATE locks (and the open transaction) open far longer than necessary.
    const variantCaseSql = [];
    const variantCaseParams = [];
    const variantIdsToUpdate = [];
    const productCaseSql = [];
    const productCaseParams = [];
    const productIdsToUpdate = [];

    for (const product of products) {
      const variants = variantsByProduct.get(product.id);
      if (variants?.length) {
        const discountedVariants = variants.map((v) => ({ ...v, discount_price: computeDiscount(Number(v.price)) }));
        if (!discountedVariants.some((v) => v.discount_price != null)) continue;
        for (const v of discountedVariants) {
          if (v.discount_price == null) continue;
          variantCaseSql.push('WHEN ? THEN ?');
          variantCaseParams.push(v.id, v.discount_price);
          variantIdsToUpdate.push(v.id);
        }
        const effectivePrice = Math.min(...discountedVariants.map(variantEffectivePrice));
        productCaseSql.push('WHEN ? THEN ?');
        productCaseParams.push(product.id, effectivePrice);
        productIdsToUpdate.push(product.id);
      } else {
        const discountPrice = computeDiscount(Number(product.price));
        if (discountPrice == null) continue;
        productCaseSql.push('WHEN ? THEN ?');
        productCaseParams.push(product.id, discountPrice);
        productIdsToUpdate.push(product.id);
      }
    }

    if (variantIdsToUpdate.length > 0) {
      await connection.query(
        `UPDATE product_variants SET discount_price = CASE id ${variantCaseSql.join(' ')} END WHERE id IN (${variantIdsToUpdate.map(() => '?').join(',')})`,
        [...variantCaseParams, ...variantIdsToUpdate]
      );
    }
    if (productIdsToUpdate.length > 0) {
      await connection.query(
        `UPDATE products SET discount_price = CASE id ${productCaseSql.join(' ')} END, is_on_sale = 1 WHERE id IN (${productIdsToUpdate.map(() => '?').join(',')})`,
        [...productCaseParams, ...productIdsToUpdate]
      );
    }

    await connection.commit();
    res.json({ message: 'Sale applied', updated: productIdsToUpdate.length });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
