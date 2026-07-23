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

  describe('PUT /api/admin/categories/:id — cycle protection', () => {
    it('rejects a category being set as its own parent', async () => {
      const res = await adminAgent.put(`/api/admin/categories/${categoryId}`).send({ name: 'Test Category', slug: `test-category-cycle-${Date.now()}`, parent_id: categoryId });
      assert.equal(res.status, 400);
    });

    it('rejects a child category being set as the parent of its own ancestor', async () => {
      const childSlug = `test-category-child-${Date.now()}`;
      const child = await adminAgent.post('/api/admin/categories').send({ name: 'Test Child', slug: childSlug, parent_id: categoryId });
      assert.equal(child.status, 201);
      const childId = child.body.id;

      try {
        // categoryId -> childId already exists; pointing categoryId's parent at childId would
        // close the loop (categoryId -> childId -> categoryId), which getCategoryTree can't
        // render (a circular object graph) — see docs/AUDIT.md.
        const res = await adminAgent.put(`/api/admin/categories/${categoryId}`).send({ name: 'Test Category', slug: `test-category-${Date.now()}`, parent_id: childId });
        assert.equal(res.status, 400);
      } finally {
        await pool.query('DELETE FROM categories WHERE id = ?', [childId]);
      }
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

    it('rejects creating an attribute named "Brand" (reserved, collides with the automatic filter)', async () => {
      const res = await adminAgent.post(`/api/admin/categories/${categoryId}/attributes`).send({ name: 'Brand' });
      assert.equal(res.status, 400);
    });

    it('returns 404 renaming a nonexistent attribute', async () => {
      const res = await adminAgent.patch('/api/admin/attributes/999999999').send({ name: 'Nope' });
      assert.equal(res.status, 404);
    });

    it('returns 404 renaming a nonexistent option', async () => {
      const res = await adminAgent.patch('/api/admin/options/999999999').send({ value: 'Nope' });
      assert.equal(res.status, 404);
    });

    it('returns 404 deleting a nonexistent option', async () => {
      const res = await adminAgent.delete('/api/admin/options/999999999');
      assert.equal(res.status, 404);
    });

    it('returns 404 deleting a nonexistent attribute', async () => {
      const res = await adminAgent.delete('/api/admin/attributes/999999999');
      assert.equal(res.status, 404);
    });

    // A separate attribute/options from "Color" above, since that one (and its optionIds) is
    // reused later by the product-creation tests — deleting it here would break those.
    describe('rename/delete lifecycle (separate attribute)', () => {
      let sizeAttributeId;
      let sizeOptionIds;

      it('creates an attribute with two options', async () => {
        const attr = await adminAgent.post(`/api/admin/categories/${categoryId}/attributes`).send({ name: 'Size' });
        assert.equal(attr.status, 201);
        sizeAttributeId = attr.body.id;

        const opt1 = await adminAgent.post(`/api/admin/attributes/${sizeAttributeId}/options`).send({ value: 'Small' });
        const opt2 = await adminAgent.post(`/api/admin/attributes/${sizeAttributeId}/options`).send({ value: 'Large' });
        assert.equal(opt1.status, 201);
        assert.equal(opt2.status, 201);
        sizeOptionIds = [opt1.body.id, opt2.body.id];
      });

      it('renames the attribute', async () => {
        const res = await adminAgent.patch(`/api/admin/attributes/${sizeAttributeId}`).send({ name: 'Sizing' });
        assert.equal(res.status, 200);

        const list = await adminAgent.get(`/api/admin/categories/${categoryId}/attributes`);
        assert.ok(list.body.some((a) => a.name === 'Sizing'));
      });

      it('renames an option', async () => {
        const res = await adminAgent.patch(`/api/admin/options/${sizeOptionIds[0]}`).send({ value: 'Extra Small' });
        assert.equal(res.status, 200);

        const list = await adminAgent.get(`/api/admin/categories/${categoryId}/attributes`);
        const sizingAttr = list.body.find((a) => a.name === 'Sizing');
        assert.ok(sizingAttr.options.some((o) => o.value === 'Extra Small'));
      });

      it('deletes an option', async () => {
        const res = await adminAgent.delete(`/api/admin/options/${sizeOptionIds[1]}`);
        assert.equal(res.status, 200);

        const list = await adminAgent.get(`/api/admin/categories/${categoryId}/attributes`);
        const sizingAttr = list.body.find((a) => a.name === 'Sizing');
        assert.equal(sizingAttr.options.length, 1);
      });

      it('deletes the attribute (cascading its remaining option)', async () => {
        const res = await adminAgent.delete(`/api/admin/attributes/${sizeAttributeId}`);
        assert.equal(res.status, 200);

        const list = await adminAgent.get(`/api/admin/categories/${categoryId}/attributes`);
        assert.ok(!list.body.some((a) => a.id === sizeAttributeId));
      });
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

    it('rejects a key spec with only a label or only a value', async () => {
      const res = await adminAgent.post('/api/admin/products').send({
        name: 'Bad Key Spec', slug: `bad-key-spec-${Date.now()}`, price: 100,
        key_specs: [{ label: 'Battery', value: '' }],
      });
      assert.equal(res.status, 400);
    });

    it('creates a product with key specs and returns them merged into specifications', async () => {
      const res = await adminAgent.post('/api/admin/products').send({
        name: 'Test Widget With Specs', slug: `test-widget-specs-${Date.now()}`, price: 400,
        key_specs: [{ label: 'Battery', value: '5000mAh' }, { label: 'RAM', value: '8GB' }],
      });
      assert.equal(res.status, 201);
      createdProductIds.push(res.body.id);

      const getRes = await adminAgent.get(`/api/admin/products/${res.body.id}`);
      assert.equal(getRes.status, 200);
      assert.deepEqual(getRes.body.key_specs.map((s) => ({ label: s.label, value: s.value })), [
        { label: 'Battery', value: '5000mAh' },
        { label: 'RAM', value: '8GB' },
      ]);
      assert.deepEqual(getRes.body.specifications, [
        { attribute: 'Battery', value: '5000mAh' },
        { attribute: 'RAM', value: '8GB' },
      ]);
    });
  });

  describe('PUT/DELETE /api/admin/products/:id', () => {
    it('updates a product', async () => {
      const res = await adminAgent.put(`/api/admin/products/${createdProductIds[0]}`).send({
        name: 'Test Widget Updated', slug: `test-widget-updated-${Date.now()}`, price: 600,
      });
      assert.equal(res.status, 200);
    });

    it('replaces key specs on update (delete-then-reinsert)', async () => {
      const create = await adminAgent.post('/api/admin/products').send({
        name: 'Test Widget Specs Update', slug: `test-widget-specs-update-${Date.now()}`, price: 200,
        key_specs: [{ label: 'Color', value: 'Black' }],
      });
      assert.equal(create.status, 201);
      createdProductIds.push(create.body.id);

      const update = await adminAgent.put(`/api/admin/products/${create.body.id}`).send({
        name: 'Test Widget Specs Update', slug: `test-widget-specs-update-2-${Date.now()}`, price: 200,
        key_specs: [{ label: 'Color', value: 'White' }],
      });
      assert.equal(update.status, 200);

      const getRes = await adminAgent.get(`/api/admin/products/${create.body.id}`);
      assert.deepEqual(getRes.body.key_specs.map((s) => ({ label: s.label, value: s.value })), [{ label: 'Color', value: 'White' }]);
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
