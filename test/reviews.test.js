import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';
let businessId;
let product;
let adminAgent;
let purchaserAgent;
let nonPurchaserAgent;
const createdOrderIds = [];

describe('reviews', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    await pool.query(
      "INSERT INTO site_content (business_id, content_key, value) VALUES (?, 'payment-settings', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [businessId, JSON.stringify({ methods: { cod: { enabled: true } } })]
    );

    const [result] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, stock) VALUES (?, 'Test Review Product', ?, 1000, 50)",
      [businessId, `test-review-product-${Date.now()}`]
    );
    product = { id: result.insertId };

    const adminEmail = uniqueEmail('adminreviews');
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await pool.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Admin', ?, ?, 'admin', 1)",
      [businessId, adminEmail, passwordHash]
    );
    adminAgent = newAgent();
    await adminAgent.post('/api/auth/admin-login').send({ email: adminEmail, password: PASSWORD });

    purchaserAgent = newAgent();
    await purchaserAgent.post('/api/auth/register').send({ name: 'Purchaser', email: uniqueEmail('purchaser'), password: PASSWORD });
    const order = await purchaserAgent.post('/api/orders').send({
      shipping_address: 'Test Address Review', phone: '03001234567',
      items: [{ id: product.id, quantity: 1 }], payment_method: 'cod',
    });
    assert.equal(order.status, 201);
    createdOrderIds.push(order.body.id);

    nonPurchaserAgent = newAgent();
    await nonPurchaserAgent.post('/api/auth/register').send({ name: 'Non Purchaser', email: uniqueEmail('nonpurchaser'), password: PASSWORD });
  });

  after(async () => {
    await pool.query('DELETE FROM product_reviews WHERE product_id = ?', [product.id]);
    if (createdOrderIds.length) {
      await pool.query(`DELETE FROM order_items WHERE order_id IN (${createdOrderIds.map(() => '?').join(',')})`, createdOrderIds);
      await pool.query(`DELETE FROM orders WHERE id IN (${createdOrderIds.map(() => '?').join(',')})`, createdOrderIds);
    }
    await pool.query('DELETE FROM products WHERE id = ?', [product.id]);
    await pool.query("DELETE FROM site_content WHERE business_id = ? AND content_key = 'payment-settings'", [businessId]);
    await cleanupTestUsers();
    await pool.end();
  });

  describe('GET /api/reviews/eligibility', () => {
    it('reports purchased=false, alreadyReviewed=false for someone who has not purchased', async () => {
      const res = await nonPurchaserAgent.get(`/api/reviews/eligibility?product_id=${product.id}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.purchased, false);
      assert.equal(res.body.alreadyReviewed, false);
    });

    it('reports purchased=true for someone who has bought the product', async () => {
      const res = await purchaserAgent.get(`/api/reviews/eligibility?product_id=${product.id}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.purchased, true);
    });
  });

  describe('POST /api/reviews', () => {
    it('rejects a review from someone who has not purchased the product', async () => {
      const res = await nonPurchaserAgent.post('/api/reviews').send({ product_id: product.id, rating: 5, comment: 'Great!' });
      assert.equal(res.status, 403);
    });

    it('rejects an invalid rating', async () => {
      const res = await purchaserAgent.post('/api/reviews').send({ product_id: product.id, rating: 8 });
      assert.equal(res.status, 400);
    });

    it('creates a pending review for a purchaser', async () => {
      const res = await purchaserAgent.post('/api/reviews').send({ product_id: product.id, rating: 4, comment: 'Pretty good' });
      assert.equal(res.status, 201);
      assert.equal(res.body.pending, true);
    });

    it('rejects a second review for the same product from the same user', async () => {
      const res = await purchaserAgent.post('/api/reviews').send({ product_id: product.id, rating: 5, comment: 'Again' });
      assert.equal(res.status, 409);
    });

    it('a pending review does not appear in the public approved-reviews list', async () => {
      const res = await request.get(`/api/reviews?product_id=${product.id}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 0);
    });
  });

  describe('admin review moderation', () => {
    let reviewId;

    before(async () => {
      const [[review]] = await pool.query('SELECT id FROM product_reviews WHERE product_id = ? LIMIT 1', [product.id]);
      reviewId = review.id;
    });

    it('rejects a non-admin listing reviews', async () => {
      const res = await purchaserAgent.get('/api/admin/reviews');
      assert.equal(res.status, 403);
    });

    it('lists the pending review for an admin', async () => {
      const res = await adminAgent.get('/api/admin/reviews?status=pending');
      assert.equal(res.status, 200);
      assert.ok(res.body.reviews.some((r) => r.id === reviewId));
    });

    it('approves the review, making it visible publicly', async () => {
      const res = await adminAgent.patch(`/api/admin/reviews/${reviewId}`).send({ action: 'approve' });
      assert.equal(res.status, 200);

      const publicList = await request.get(`/api/reviews?product_id=${product.id}`);
      assert.equal(publicList.body.total, 1);
      assert.equal(publicList.body.average, 4);
    });

    it('admin can create a review directly with no purchase requirement', async () => {
      const res = await adminAgent.post(`/api/admin/products/${product.id}/reviews`).send({ author_name: 'Walk-in Customer', rating: 5 });
      assert.equal(res.status, 201);

      const publicList = await request.get(`/api/reviews?product_id=${product.id}`);
      assert.equal(publicList.body.total, 2);
    });

    it('rejecting a pending review marks it rejected, hidden from the public list', async () => {
      // already reviewed (approved above), so create a second product to get a fresh pending review to reject
      const [result] = await pool.query(
        "INSERT INTO products (business_id, name, slug, price, stock) VALUES (?, 'Test Review Product 2', ?, 500, 10)",
        [businessId, `test-review-product-2-${Date.now()}`]
      );
      const order = await purchaserAgent.post('/api/orders').send({
        shipping_address: 'Test Address Review', phone: '03001234567',
        items: [{ id: result.insertId, quantity: 1 }], payment_method: 'cod',
      });
      createdOrderIds.push(order.body.id);
      const review = await purchaserAgent.post('/api/reviews').send({ product_id: result.insertId, rating: 2, comment: 'meh' });
      assert.equal(review.status, 201);

      const rejectRes = await adminAgent.patch(`/api/admin/reviews/${review.body.id}`).send({ action: 'reject' });
      assert.equal(rejectRes.status, 200);

      const [[stillThere]] = await pool.query('SELECT id, status FROM product_reviews WHERE id = ?', [review.body.id]);
      assert.equal(stillThere.status, 'rejected');

      const publicAfterReject = await request.get(`/api/reviews?product_id=${result.insertId}`);
      assert.equal(publicAfterReject.body.total, 0);

      await pool.query('DELETE FROM products WHERE id = ?', [result.insertId]);
    });
  });
});
