import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';
import { request } from './_support/helpers.js';

// The highest-traffic code path in the whole app — every customer hits these on every page
// load — had zero test coverage before this file. Covers listing (pagination/sort/filters),
// product detail (variant pricing), brands, search suggestions, and category browsing
// (tree + merged attributes), all against real DB rows.
let businessId;
let categoryId;
let subcategoryId;
let plainProduct;
let saleProduct;
let variantProduct;
let variantId;
let attributeId;
let optionId;

describe('public product & category browsing', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    const [catResult] = await pool.query(
      "INSERT INTO categories (business_id, name, slug, sort_order) VALUES (?, 'Test Browse Category', ?, 0)",
      [businessId, `test-browse-cat-${Date.now()}`]
    );
    categoryId = catResult.insertId;

    const [subResult] = await pool.query(
      "INSERT INTO categories (business_id, name, slug, parent_id, sort_order) VALUES (?, 'Test Browse Subcategory', ?, ?, 0)",
      [businessId, `test-browse-subcat-${Date.now()}`, categoryId]
    );
    subcategoryId = subResult.insertId;

    const [plainResult] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, stock, brand, category_id) VALUES (?, 'Zeta Test Widget', ?, 500, 10, 'AlphaBrand', ?)",
      [businessId, `test-browse-plain-${Date.now()}`, categoryId]
    );
    plainProduct = { id: plainResult.insertId };

    const [saleResult] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, discount_price, is_on_sale, stock, brand, category_id) VALUES (?, 'Alpha Test Gadget', ?, 1000, 750, 1, 5, 'BetaBrand', ?)",
      [businessId, `test-browse-sale-${Date.now()}`, categoryId]
    );
    saleProduct = { id: saleResult.insertId };

    const [variantResult] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, stock, category_id) VALUES (?, 'Test Variant Product', ?, 2000, 0, ?)",
      [businessId, `test-browse-variant-${Date.now()}`, categoryId]
    );
    variantProduct = { id: variantResult.insertId };

    const [attrResult] = await pool.query(
      "INSERT INTO category_attributes (business_id, category_id, name) VALUES (?, ?, 'Test Storage')",
      [businessId, categoryId]
    );
    attributeId = attrResult.insertId;
    const [optResult] = await pool.query(
      'INSERT INTO category_attribute_options (attribute_id, value) VALUES (?, ?)',
      [attributeId, '256 GB']
    );
    optionId = optResult.insertId;

    const [variantRowResult] = await pool.query(
      'INSERT INTO product_variants (business_id, product_id, price, discount_price, stock) VALUES (?, ?, 1800, 1500, 3)',
      [businessId, variantProduct.id]
    );
    variantId = variantRowResult.insertId;
    await pool.query('INSERT INTO product_variant_options (variant_id, option_id) VALUES (?, ?)', [variantId, optionId]);
    await pool.query('INSERT INTO product_attribute_values (product_id, option_id) VALUES (?, ?)', [variantProduct.id, optionId]);
  });

  after(async () => {
    await pool.query('DELETE FROM product_variant_options WHERE variant_id = ?', [variantId]);
    await pool.query('DELETE FROM product_variants WHERE product_id = ?', [variantProduct.id]);
    await pool.query('DELETE FROM product_attribute_values WHERE product_id = ?', [variantProduct.id]);
    await pool.query('DELETE FROM category_attribute_options WHERE id = ?', [optionId]);
    await pool.query('DELETE FROM category_attributes WHERE id = ?', [attributeId]);
    await pool.query('DELETE FROM products WHERE id IN (?, ?, ?)', [plainProduct.id, saleProduct.id, variantProduct.id]);
    await pool.query('DELETE FROM categories WHERE id IN (?, ?)', [subcategoryId, categoryId]);
    await pool.end();
  });

  describe('GET /api/products', () => {
    it('returns a paginated list with the expected shape', async () => {
      const res = await request.get('/api/products?page=1');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.products));
      assert.ok('total' in res.body);
      assert.ok('page' in res.body);
      assert.ok('totalPages' in res.body);
    });

    it('filters by category, including its subcategory', async () => {
      const res = await request.get(`/api/products?category=${encodeURIComponent((await pool.query('SELECT slug FROM categories WHERE id = ?', [categoryId]))[0][0].slug)}`);
      assert.equal(res.status, 200);
      const ids = res.body.products.map((p) => p.id);
      assert.ok(ids.includes(plainProduct.id));
      assert.ok(ids.includes(saleProduct.id));
    });

    it('filters by brand, case-insensitively', async () => {
      const res = await request.get('/api/products?brand=alphabrand');
      assert.equal(res.status, 200);
      assert.ok(res.body.products.some((p) => p.id === plainProduct.id));
      assert.ok(!res.body.products.some((p) => p.id === saleProduct.id));
    });

    it('filters by on_sale', async () => {
      const res = await request.get('/api/products?on_sale=1');
      assert.equal(res.status, 200);
      assert.ok(res.body.products.some((p) => p.id === saleProduct.id));
      assert.ok(!res.body.products.some((p) => p.id === plainProduct.id));
    });

    it('filters by search across name/brand', async () => {
      const res = await request.get('/api/products?search=Zeta Test Widget');
      assert.equal(res.status, 200);
      assert.ok(res.body.products.some((p) => p.id === plainProduct.id));
    });

    it('sorts by price ascending and descending correctly', async () => {
      const asc = await request.get('/api/products?sort=price_asc&category=' + (await pool.query('SELECT slug FROM categories WHERE id = ?', [categoryId]))[0][0].slug);
      const prices = asc.body.products.map((p) => Number(p.price));
      const sorted = [...prices].sort((a, b) => a - b);
      assert.deepEqual(prices, sorted);

      const desc = await request.get('/api/products?sort=price_desc&category=' + (await pool.query('SELECT slug FROM categories WHERE id = ?', [categoryId]))[0][0].slug);
      const pricesDesc = desc.body.products.map((p) => Number(p.price));
      const sortedDesc = [...prices].sort((a, b) => b - a);
      assert.deepEqual(pricesDesc, sortedDesc);
    });

    it('marks has_variants correctly on the list', async () => {
      const res = await request.get('/api/products?search=Test Variant Product');
      const found = res.body.products.find((p) => p.id === variantProduct.id);
      assert.ok(found);
      assert.equal(found.has_variants, true);

      const plainRes = await request.get('/api/products?search=Zeta Test Widget');
      const plainFound = plainRes.body.products.find((p) => p.id === plainProduct.id);
      assert.equal(plainFound.has_variants, false);
    });

    it('filters by category-attribute option', async () => {
      const res = await request.get(`/api/products?options=${optionId}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.products.some((p) => p.id === variantProduct.id));
      assert.ok(!res.body.products.some((p) => p.id === plainProduct.id));
    });
  });

  describe('GET /api/products/:slug', () => {
    it('returns 404 for a nonexistent slug', async () => {
      const res = await request.get('/api/products/definitely-does-not-exist-slug-xyz');
      assert.equal(res.status, 404);
    });

    it('returns full product detail with correct discount fields', async () => {
      const [[row]] = await pool.query('SELECT slug FROM products WHERE id = ?', [saleProduct.id]);
      const res = await request.get(`/api/products/${row.slug}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.id, saleProduct.id);
      assert.equal(Number(res.body.discount_price), 750);
      assert.equal(Number(res.body.is_on_sale), 1);
    });

    it('returns variants with correct pricing and option labels', async () => {
      const [[row]] = await pool.query('SELECT slug FROM products WHERE id = ?', [variantProduct.id]);
      const res = await request.get(`/api/products/${row.slug}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.variants));
      assert.equal(res.body.variants.length, 1);
      const variant = res.body.variants[0];
      assert.equal(variant.id, variantId);
      assert.equal(Number(variant.price), 1800);
      assert.equal(Number(variant.discount_price), 1500);
      assert.equal(variant.options.length, 1);
      assert.equal(variant.options[0].attribute, 'Test Storage');
      assert.equal(variant.options[0].value, '256 GB');
    });
  });

  describe('GET /api/products/brands', () => {
    it('returns a deduped, sorted brand list', async () => {
      const res = await request.get('/api/products/brands');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.includes('AlphaBrand'));
      assert.ok(res.body.includes('BetaBrand'));
      const sorted = [...res.body].sort((a, b) => a.localeCompare(b));
      assert.deepEqual(res.body, sorted);
    });
  });

  describe('GET /api/products/suggest', () => {
    it('returns an empty array with no query', async () => {
      const res = await request.get('/api/products/suggest');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, []);
    });

    it('matches by name and ranks exact-prefix matches first', async () => {
      const res = await request.get('/api/products/suggest?q=Zeta Test');
      assert.equal(res.status, 200);
      assert.ok(res.body.some((p) => p.id === plainProduct.id));
    });
  });

  describe('GET /api/categories/tree', () => {
    it('nests subcategories under their parent', async () => {
      const res = await request.get('/api/categories/tree');
      assert.equal(res.status, 200);
      const parent = res.body.find((c) => c.id === categoryId);
      assert.ok(parent, 'parent category should be a top-level tree node');
      assert.ok(parent.subcategories.some((s) => s.id === subcategoryId));
    });
  });

  describe('GET /api/categories/:slug', () => {
    it('returns 404 for a nonexistent slug', async () => {
      const res = await request.get('/api/categories/definitely-does-not-exist-cat-xyz');
      assert.equal(res.status, 404);
    });

    it('includes subcategories, merged attributes, and available brands', async () => {
      const [[row]] = await pool.query('SELECT slug FROM categories WHERE id = ?', [categoryId]);
      const res = await request.get(`/api/categories/${row.slug}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.subcategories.some((s) => s.id === subcategoryId));
      assert.ok(Array.isArray(res.body.attributes));
      const attr = res.body.attributes.find((a) => a.name === 'Test Storage');
      assert.ok(attr, 'merged attributes should include the test attribute');
      assert.ok(attr.options.some((o) => o.value === '256 GB'));
      assert.ok(res.body.availableBrands.includes('AlphaBrand'));
      assert.ok(res.body.availableBrands.includes('BetaBrand'));
    });
  });
});
