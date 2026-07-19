import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';
let businessId;
let adminAgent;
let customerAgent;
let orderId;
let customerId;

describe('admin reports', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    const adminEmail = uniqueEmail('adminreports');
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await pool.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Admin', ?, ?, 'admin', 1)",
      [businessId, adminEmail, passwordHash]
    );
    adminAgent = newAgent();
    await adminAgent.post('/api/auth/admin-login').send({ email: adminEmail, password: PASSWORD });

    const customerEmail = uniqueEmail('customerreports');
    await pool.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Customer', ?, ?, 'customer', 1)",
      [businessId, customerEmail, passwordHash]
    );
    const [[customer]] = await pool.query('SELECT id FROM users WHERE email = ?', [customerEmail]);
    customerId = customer.id;

    customerAgent = newAgent();
    await customerAgent.post('/api/auth/login').send({ email: customerEmail, password: PASSWORD });

    // A single confirmed order with two line items, one flagged as sale-priced — enough to
    // exercise every report's grouping/aggregation without needing the full checkout flow.
    const [orderResult] = await pool.query(
      `INSERT INTO orders (business_id, user_id, total_amount, status, shipping_address, shipping_city, phone, payment_method)
       VALUES (?, ?, 7500, 'confirmed', '123 Test St', 'Karachi', '03001234567', 'cod')`,
      [businessId, customerId]
    );
    orderId = orderResult.insertId;
    await pool.query(
      `INSERT INTO order_items (order_id, product_ref, product_name, quantity, price, is_sale_price)
       VALUES (?, 'test-report-product-1', 'Report Test Product 1', 2, 2000, 1),
              (?, 'test-report-product-2', 'Report Test Product 2', 1, 3500, 0)`,
      [orderId, orderId]
    );
  });

  after(async () => {
    if (orderId) {
      await pool.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
      await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
    }
    await cleanupTestUsers();
    await pool.end();
  });

  for (const path of [
    'revenue-trend', 'revenue-summary', 'top-products', 'bottom-products', 'sales-by-city',
    'order-status-breakdown', 'payment-method-breakdown', 'order-value-histogram', 'sale-split',
  ]) {
    it(`GET /api/admin/reports/${path} rejects a non-admin`, async () => {
      const res = await customerAgent.get(`/api/admin/reports/${path}`);
      assert.equal(res.status, 403);
    });

    it(`GET /api/admin/reports/${path} rejects an unauthenticated request`, async () => {
      const res = await request.get(`/api/admin/reports/${path}`);
      assert.equal(res.status, 401);
    });
  }

  describe('GET /api/admin/reports/revenue-trend', () => {
    it('returns a 30-day bucketed series by default', async () => {
      const res = await adminAgent.get('/api/admin/reports/revenue-trend');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 30);
      const total = res.body.reduce((sum, b) => sum + b.orders, 0);
      assert.ok(total >= 1, 'the seeded order appears somewhere in the trend');
    });

    it('returns a 12-month bucketed series for period=12m', async () => {
      const res = await adminAgent.get('/api/admin/reports/revenue-trend').query({ period: '12m' });
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 12);
    });

    it('returns a 7-day bucketed series for period=7d', async () => {
      const res = await adminAgent.get('/api/admin/reports/revenue-trend').query({ period: '7d' });
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 7);
    });
  });

  describe('GET /api/admin/reports/revenue-summary', () => {
    it('includes the seeded order in week/month/year/allTime totals', async () => {
      const res = await adminAgent.get('/api/admin/reports/revenue-summary');
      assert.equal(res.status, 200);
      for (const bucket of ['week', 'month', 'year', 'allTime']) {
        assert.ok(res.body[bucket].revenue >= 7500, `${bucket} revenue includes the seeded order`);
        assert.ok(res.body[bucket].orders >= 1, `${bucket} order count includes the seeded order`);
      }
    });
  });

  describe('GET /api/admin/reports/top-products', () => {
    it('ranks by revenue by default', async () => {
      const res = await adminAgent.get('/api/admin/reports/top-products');
      assert.equal(res.status, 200);
      const p2 = res.body.find((r) => r.product_ref === 'test-report-product-2');
      assert.ok(p2);
      assert.equal(p2.totalRevenue, 3500);
    });

    it('ranks by quantity when by=quantity', async () => {
      const res = await adminAgent.get('/api/admin/reports/top-products').query({ by: 'quantity' });
      assert.equal(res.status, 200);
      const p1 = res.body.find((r) => r.product_ref === 'test-report-product-1');
      assert.ok(p1);
      assert.equal(p1.totalQuantity, 2);
    });
  });

  describe('GET /api/admin/reports/bottom-products', () => {
    it('returns products with zero sales too', async () => {
      const res = await adminAgent.get('/api/admin/reports/bottom-products');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });
  });

  describe('GET /api/admin/reports/sales-by-city', () => {
    it('includes the seeded order under its shipping city', async () => {
      const res = await adminAgent.get('/api/admin/reports/sales-by-city');
      assert.equal(res.status, 200);
      const karachi = res.body.find((r) => r.city === 'Karachi');
      assert.ok(karachi);
      assert.ok(karachi.revenue >= 7500);
    });
  });

  describe('GET /api/admin/reports/order-status-breakdown', () => {
    it('includes a confirmed bucket with the seeded order', async () => {
      const res = await adminAgent.get('/api/admin/reports/order-status-breakdown');
      assert.equal(res.status, 200);
      const confirmed = res.body.find((r) => r.status === 'confirmed');
      assert.ok(confirmed);
      assert.ok(confirmed.orders >= 1);
    });
  });

  describe('GET /api/admin/reports/payment-method-breakdown', () => {
    it('includes the seeded order under cod', async () => {
      const res = await adminAgent.get('/api/admin/reports/payment-method-breakdown');
      assert.equal(res.status, 200);
      const cod = res.body.find((r) => r.method === 'cod');
      assert.ok(cod);
      assert.ok(cod.revenue >= 7500);
    });
  });

  describe('GET /api/admin/reports/order-value-histogram', () => {
    it('returns all 5 fixed buckets, including the seeded order in 5k-10k', async () => {
      const res = await adminAgent.get('/api/admin/reports/order-value-histogram');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 5);
      const bucket = res.body.find((b) => b.bucket === '5k-10k');
      assert.ok(bucket.orders >= 1);
    });
  });

  describe('GET /api/admin/reports/sale-split', () => {
    it('splits the seeded order items into sale vs regular revenue', async () => {
      const res = await adminAgent.get('/api/admin/reports/sale-split');
      assert.equal(res.status, 200);
      assert.ok(res.body.saleRevenue >= 4000, 'sale-priced item (qty 2 * 2000)');
      assert.ok(res.body.regularRevenue >= 3500, 'regular-priced item');
    });
  });
});
