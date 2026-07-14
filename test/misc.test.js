import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';
let businessId;
let adminAgent;
let customerAgent;
let product;

describe('lower-priority coverage', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    const [result] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, stock) VALUES (?, 'Test Misc Product', ?, 100, 10)",
      [businessId, `test-misc-product-${Date.now()}`]
    );
    product = { id: result.insertId };

    const adminEmail = uniqueEmail('adminmisc');
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await pool.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Admin', ?, ?, 'admin', 1)",
      [businessId, adminEmail, passwordHash]
    );
    adminAgent = newAgent();
    await adminAgent.post('/api/auth/admin-login').send({ email: adminEmail, password: PASSWORD });

    customerAgent = newAgent();
    await customerAgent.post('/api/auth/register').send({ name: 'Test Customer', email: uniqueEmail('customermisc'), password: PASSWORD });
  });

  after(async () => {
    await pool.query('DELETE FROM wishlist_items WHERE product_id = ?', [product.id]);
    await pool.query('DELETE FROM products WHERE id = ?', [product.id]);
    await pool.query("DELETE FROM newsletter_subscribers WHERE email LIKE 'test-%@example.com'");
    await pool.query("DELETE FROM courier_settings WHERE business_id = ?", [businessId]);
    await pool.query("DELETE FROM site_content WHERE business_id = ? AND content_key = 'announcement-bar'", [businessId]);
    await cleanupTestUsers();
    await pool.end();
  });

  describe('wishlist', () => {
    it('requires authentication', async () => {
      const res = await request.get('/api/wishlist');
      assert.equal(res.status, 401);
    });

    it('rejects adding a nonexistent product', async () => {
      const res = await customerAgent.post('/api/wishlist').send({ product_id: 999999999 });
      assert.equal(res.status, 404);
    });

    it('adds a product to the wishlist', async () => {
      const res = await customerAgent.post('/api/wishlist').send({ product_id: product.id });
      assert.equal(res.status, 201);

      const list = await customerAgent.get('/api/wishlist');
      assert.equal(list.body.length, 1);
    });

    it('adding the same product again does not create a duplicate row', async () => {
      const res = await customerAgent.post('/api/wishlist').send({ product_id: product.id });
      assert.equal(res.status, 201);

      const list = await customerAgent.get('/api/wishlist');
      assert.equal(list.body.length, 1);
    });

    it('removes a product from the wishlist', async () => {
      const res = await customerAgent.delete(`/api/wishlist/${product.id}`);
      assert.equal(res.status, 200);

      const list = await customerAgent.get('/api/wishlist');
      assert.equal(list.body.length, 0);
    });
  });

  describe('newsletter', () => {
    const email = uniqueEmail('newslettermisc');

    it('rejects an invalid email', async () => {
      const res = await request.post('/api/newsletter/subscribe').send({ email: 'not-an-email' });
      assert.equal(res.status, 400);
    });

    it('subscribes a new email', async () => {
      const res = await request.post('/api/newsletter/subscribe').send({ email });
      assert.equal(res.status, 201);
      assert.equal(res.body.alreadySubscribed, false);
    });

    it('reports alreadySubscribed for a repeat subscribe', async () => {
      const res = await request.post('/api/newsletter/subscribe').send({ email });
      assert.equal(res.status, 201);
      assert.equal(res.body.alreadySubscribed, true);
    });

    it('reflects the subscription in the status check', async () => {
      const res = await request.get(`/api/newsletter/status?email=${encodeURIComponent(email)}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.subscribed, true);
    });
  });

  describe('contact', () => {
    it('rejects a request missing required fields', async () => {
      const res = await request.post('/api/contact').send({ name: 'Test' });
      assert.equal(res.status, 400);
    });

    it('rejects an invalid email', async () => {
      const res = await request.post('/api/contact').send({ name: 'Test', email: 'not-an-email', message: 'Hello' });
      assert.equal(res.status, 400);
    });
  });

  describe('currency', () => {
    it('returns PKR-based rates', async () => {
      const res = await request.get('/api/currency/rates');
      assert.equal(res.status, 200);
      assert.equal(res.body.base, 'PKR');
      assert.ok(res.body.rates);
    });
  });

  describe('site content', () => {
    it('returns 404 for an unknown content key', async () => {
      const res = await request.get('/api/content/not-a-real-key');
      assert.equal(res.status, 404);
    });

    it('returns default content for a known key with nothing customized', async () => {
      const res = await request.get('/api/content/announcement-bar');
      assert.equal(res.status, 200);
    });

    it('rejects a non-admin content update', async () => {
      const res = await customerAgent.put('/api/admin/content/announcement-bar').send({ enabled: true, text: 'Sale!' });
      assert.equal(res.status, 403);
    });

    it('an admin can update content, and the change is reflected on read', async () => {
      const res = await adminAgent.put('/api/admin/content/announcement-bar').send({
        enabled: true, text: 'Test Sale Banner', bgColor: '#000000', textColor: '#ffffff', speed: 20,
      });
      assert.equal(res.status, 200);

      const read = await request.get('/api/content/announcement-bar');
      assert.equal(read.body.text, 'Test Sale Banner');
    });
  });

  describe('admin customers', () => {
    it('rejects a non-admin request', async () => {
      const res = await customerAgent.get('/api/admin/customers');
      assert.equal(res.status, 403);
    });

    it('lists customers, paginated', async () => {
      const res = await adminAgent.get('/api/admin/customers');
      assert.equal(res.status, 200);
      assert.ok('customers' in res.body);
      assert.ok('total' in res.body);
    });

    it('returns 404 for a nonexistent customer', async () => {
      const res = await adminAgent.get('/api/admin/customers/999999999');
      assert.equal(res.status, 404);
    });
  });

  describe('admin courier settings', () => {
    it('rejects a non-admin request', async () => {
      const res = await customerAgent.get('/api/admin/courier-settings');
      assert.equal(res.status, 403);
    });

    it('rejects a tracking URL template missing the {tracking_number} placeholder', async () => {
      const res = await adminAgent.put('/api/admin/courier-settings').send({ tracking_url_template: 'https://example.com/track' });
      assert.equal(res.status, 400);
    });

    it('saves valid courier settings, and reports has_api_key without leaking the raw secret', async () => {
      const save = await adminAgent.put('/api/admin/courier-settings').send({
        provider: 'Leopards Courier', enabled: true, api_key: 'test-secret-key',
        tracking_url_template: 'https://example.com/track/{tracking_number}',
      });
      assert.equal(save.status, 200);

      const read = await adminAgent.get('/api/admin/courier-settings');
      assert.equal(read.status, 200);
      assert.equal(read.body.has_api_key, true);
      assert.equal(read.body.api_key, undefined);
    });
  });
});
