import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';
let businessId;
let adminAgent;
let customerAgent;
let categoryId;
let optionIds = [];
const createdProductIds = [];

describe('admin products and categories', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    const adminEmail = uniqueEmail('adminproducts');
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await pool.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Admin', ?, ?, 'admin', 1)",
      [businessId, adminEmail, passwordHash]
    );
    adminAgent = newAgent();
    await adminAgent.post('/api/auth/admin-login').send({ email: adminEmail, password: PASSWORD });

    customerAgent = newAgent();
    await customerAgent.post('/api/auth/register').send({ name: 'Test Customer', email: uniqueEmail('customerproducts'), password: PASSWORD });
  });

  after(async () => {
    if (createdProductIds.length) {
      await pool.query(`DELETE FROM product_attribute_values WHERE product_id IN (${createdProductIds.map(() => '?').join(',')})`, createdProductIds);
      await pool.query(`DELETE FROM products WHERE id IN (${createdProductIds.map(() => '?').join(',')})`, createdProductIds);
    }
    if (categoryId) {
      await pool.query('DELETE FROM category_attribute_options WHERE attribute_id IN (SELECT id FROM category_attributes WHERE category_id = ?)', [categoryId]);
      await pool.query('DELETE FROM category_attributes WHERE category_id = ?', [categoryId]);
      await pool.query('DELETE FROM categories WHERE id = ?', [categoryId]);
    }
    await cleanupTestUsers();
    await pool.end();
  });

  describe('POST /api/admin/categories', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request.post('/api/admin/categories').send({ name: 'X', slug: 'x' });
      assert.equal(res.status, 401);
    });

    it('rejects a non-admin request', async () => {
      const res = await customerAgent.post('/api/admin/categories').send({ name: 'X', slug: 'x' });
      assert.equal(res.status, 403);
    });

    it('rejects a request missing name/slug', async () => {
      const res = await adminAgent.post('/api/admin/categories').send({ name: 'Missing Slug' });
      assert.equal(res.status, 400);
    });

    it('creates a category', async () => {
      const slug = `test-category-${Date.now()}`;
      const res = await adminAgent.post('/api/admin/categories').send({ name: 'Test Category', slug });
      assert.equal(res.status, 201);
      categoryId = res.body.id;
    });

    it('rejects a duplicate category slug', async () => {
      const res = await adminAgent.post('/api/admin/categories').send({ name: 'Test Category Dup', slug: (await pool.query('SELECT slug FROM categories WHERE id = ?', [categoryId]))[0][0].slug });
      assert.equal(res.status, 409);
    });
  });

  describe('category attributes', () => {
    let attributeId;

    it('creates an attribute with two options', async () => {
      const attr = await adminAgent.post(`/api/admin/categories/${categoryId}/attributes`).send({ name: 'Color' });
      assert.equal(attr.status, 201);
      attributeId = attr.body.id;

      const opt1 = await adminAgent.post(`/api/admin/attributes/${attributeId}/options`).send({ value: 'Red' });
      const opt2 = await adminAgent.post(`/api/admin/attributes/${attributeId}/options`).send({ value: 'Blue' });
      assert.equal(opt1.status, 201);
      assert.equal(opt2.status, 201);
      optionIds = [opt1.body.id, opt2.body.id];
    });

    it('lists the attribute with its options for the category', async () => {
      const res = await adminAgent.get(`/api/admin/categories/${categoryId}/attributes`);
      assert.equal(res.status, 200);
      const colorAttr = res.body.find((a) => a.name === 'Color');
      assert.ok(colorAttr);
      assert.equal(colorAttr.options.length, 2);
    });
  });

  describe('POST /api/admin/products', () => {
    it('rejects missing required fields', async () => {
      const res = await adminAgent.post('/api/admin/products').send({ name: 'No Slug' });
      assert.equal(res.status, 400);
    });

    it('rejects a negative price', async () => {
      const res = await adminAgent.post('/api/admin/products').send({ name: 'Bad Price', slug: `bad-price-${Date.now()}`, price: -10 });
      assert.equal(res.status, 400);
    });

    it('rejects is_on_sale without a valid discount_price', async () => {
      const res = await adminAgent.post('/api/admin/products').send({
        name: 'Bad Sale', slug: `bad-sale-${Date.now()}`, price: 100, is_on_sale: true,
      });
      assert.equal(res.status, 400);
    });

    it('rejects a discount_price that is not less than price', async () => {
      const res = await adminAgent.post('/api/admin/products').send({
        name: 'Bad Discount', slug: `bad-discount-${Date.now()}`, price: 100, is_on_sale: true, discount_price: 150,
      });
      assert.equal(res.status, 400);
    });

    it('creates a product', async () => {
      const res = await adminAgent.post('/api/admin/products').send({
        name: 'Test Widget', slug: `test-widget-${Date.now()}`, price: 500, stock: 20, category_id: categoryId,
      });
      assert.equal(res.status, 201);
      createdProductIds.push(res.body.id);
    });

    it('rejects a duplicate name/slug', async () => {
      const [[existing]] = await pool.query('SELECT slug FROM products WHERE id = ?', [createdProductIds[0]]);
      const res = await adminAgent.post('/api/admin/products').send({ name: 'Dup', slug: existing.slug, price: 100 });
      assert.equal(res.status, 409);
    });

    // Regression test for the setProductAttributeOptions bug: a repeated option_id used to hit
    // product_attribute_values' unique constraint and get misreported as a duplicate name/slug.
    it('accepts duplicate attribute_option_ids without crashing', async () => {
      const res = await adminAgent.post('/api/admin/products').send({
        name: 'Test Widget Dup Options', slug: `test-widget-dupopts-${Date.now()}`, price: 300,
        attribute_option_ids: [optionIds[0], optionIds[0], optionIds[1]],
      });
      assert.equal(res.status, 201);
      createdProductIds.push(res.body.id);

      const [rows] = await pool.query('SELECT option_id FROM product_attribute_values WHERE product_id = ?', [res.body.id]);
      assert.equal(rows.length, 2);
    });
  });

  describe('PUT/DELETE /api/admin/products/:id', () => {
    it('updates a product', async () => {
      const res = await adminAgent.put(`/api/admin/products/${createdProductIds[0]}`).send({
        name: 'Test Widget Updated', slug: `test-widget-updated-${Date.now()}`, price: 600,
      });
      assert.equal(res.status, 200);
    });

    it('returns 404 updating a nonexistent product', async () => {
      const res = await adminAgent.put('/api/admin/products/999999999').send({ name: 'X', slug: 'x-nonexistent', price: 1 });
      assert.equal(res.status, 404);
    });

    it('deletes a product', async () => {
      const res = await adminAgent.delete(`/api/admin/products/${createdProductIds[1]}`);
      assert.equal(res.status, 200);
      createdProductIds.splice(1, 1);
    });

    it('returns 404 deleting an already-deleted product', async () => {
      const res = await adminAgent.delete('/api/admin/products/999999999');
      assert.equal(res.status, 404);
    });
  });
});
