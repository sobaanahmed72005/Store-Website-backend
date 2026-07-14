import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import pool from '../config/db.js';
import { paymentProofsDir } from '../middleware/upload.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';
let businessId;
let product;
let adminAgent;
let customerAgent;
let customerId;

async function createTestOrder(agent) {
  const res = await agent.post('/api/orders').send({
    shipping_address: 'Test Address Admin', phone: '03001234567',
    items: [{ id: product.id, quantity: 1 }], payment_method: 'cod',
  });
  assert.equal(res.status, 201);
  return res.body.id;
}

describe('admin order management', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    await pool.query(
      "INSERT INTO site_content (business_id, content_key, value) VALUES (?, 'payment-settings', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [businessId, JSON.stringify({ methods: { cod: { enabled: true } } })]
    );

    const [result] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, stock) VALUES (?, 'Test Admin Product', ?, 1000, 100)",
      [businessId, `test-admin-product-${Date.now()}`]
    );
    product = { id: result.insertId };

    const adminEmail = uniqueEmail('adminorders');
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await pool.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Admin', ?, ?, 'admin', 1)",
      [businessId, adminEmail, passwordHash]
    );
    adminAgent = newAgent();
    const adminLogin = await adminAgent.post('/api/auth/admin-login').send({ email: adminEmail, password: PASSWORD });
    assert.equal(adminLogin.status, 200);

    customerAgent = newAgent();
    const customerEmail = uniqueEmail('customerorders');
    await customerAgent.post('/api/auth/register').send({ name: 'Test Customer', email: customerEmail, password: PASSWORD });
    const me = await customerAgent.get('/api/auth/me');
    customerId = me.body.user.id;
  });

  after(async () => {
    await pool.query('DELETE FROM order_items WHERE product_ref = ?', [String(product.id)]);
    await pool.query('DELETE FROM orders WHERE business_id = ? AND shipping_address = ?', [businessId, 'Test Address Admin']);
    await pool.query('DELETE FROM products WHERE id = ?', [product.id]);
    await pool.query("DELETE FROM site_content WHERE business_id = ? AND content_key = 'payment-settings'", [businessId]);
    await cleanupTestUsers();
    await pool.end();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request.get('/api/admin/orders');
      assert.equal(res.status, 401);
    });

    it('rejects a customer (non-admin) request', async () => {
      const res = await customerAgent.get('/api/admin/orders');
      assert.equal(res.status, 403);
    });

    it('allows an admin request', async () => {
      const res = await adminAgent.get('/api/admin/orders');
      assert.equal(res.status, 200);
    });
  });

  describe('PUT /api/admin/orders/:id/status', () => {
    it('rejects an invalid status transition', async () => {
      const orderId = await createTestOrder(customerAgent);
      // a pending order can only go to confirmed/cancelled, not straight to shipped
      const res = await adminAgent.put(`/api/admin/orders/${orderId}/status`).send({ status: 'shipped' });
      assert.equal(res.status, 400);
    });

    // Regression test for the double-booking race fix: updateOrderStatus used to book a real
    // courier shipment *before* the concurrency-guarded status update, so two concurrent
    // requests could both pass validation and both book. The fix claims the transition
    // atomically first — only the request that actually wins should succeed.
    it('lets only one of two concurrent status updates on the same order succeed', async () => {
      const orderId = await createTestOrder(customerAgent);

      const [first, second] = await Promise.all([
        adminAgent.put(`/api/admin/orders/${orderId}/status`).send({ status: 'confirmed' }),
        adminAgent.put(`/api/admin/orders/${orderId}/status`).send({ status: 'confirmed' }),
      ]);

      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409]);

      const [[order]] = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);
      assert.equal(order.status, 'confirmed');
    });
  });

  describe('GET /api/orders/payment-proof/:filename', () => {
    let proofUrl;
    let otherCustomerAgent;

    before(async () => {
      const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
      const upload = await customerAgent.post('/api/orders/payment-proof').attach('image', png, 'proof.png');
      assert.equal(upload.status, 201);
      proofUrl = upload.body.url;

      await customerAgent.post('/api/orders').send({
        shipping_address: 'Test Address Admin', phone: '03001234567',
        items: [{ id: product.id, quantity: 1 }], payment_method: 'cod', // still cod so no ref/proof required to be truthful
      });

      // attach the uploaded proof to a real bank-transfer-style order so servePaymentProof has
      // an order row to authorize against
      await pool.query(
        "INSERT INTO site_content (business_id, content_key, value) VALUES (?, 'payment-settings', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [businessId, JSON.stringify({ methods: { cod: { enabled: true }, bank_transfer: { enabled: true } } })]
      );
      const order = await customerAgent.post('/api/orders').send({
        shipping_address: 'Test Address Admin', phone: '03001234567',
        items: [{ id: product.id, quantity: 1 }], payment_method: 'bank_transfer',
        payment_reference: 'TEST-REF-ADMIN', payment_proof_image: proofUrl,
      });
      assert.equal(order.status, 201);

      otherCustomerAgent = newAgent();
      const otherEmail = uniqueEmail('otherorders');
      await otherCustomerAgent.post('/api/auth/register').send({ name: 'Other Customer', email: otherEmail, password: PASSWORD });
    });

    it('lets the order owner view their own payment proof', async () => {
      const res = await customerAgent.get(proofUrl.replace('/orders', '/api/orders'));
      assert.equal(res.status, 200);
    });

    it('rejects a different customer trying to view it', async () => {
      const res = await otherCustomerAgent.get(proofUrl.replace('/orders', '/api/orders'));
      assert.equal(res.status, 403);
    });

    it('lets an admin view it', async () => {
      const res = await adminAgent.get(proofUrl.replace('/orders', '/api/orders'));
      assert.equal(res.status, 200);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request.get(proofUrl.replace('/orders', '/api/orders'));
      assert.equal(res.status, 401);
    });

    after(async () => {
      // Uploaded files land in the real, shared payment-proofs/ directory on disk — uploads
      // aren't database-scoped like everything else this suite cleans up, so this needs its own
      // explicit removal or the test PNG is left behind permanently.
      const filename = proofUrl.split('/').pop();
      await fs.unlink(path.join(paymentProofsDir, filename)).catch(() => {});
    });
  });
});
