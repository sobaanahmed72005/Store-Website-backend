import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';
let businessId;
let adminAgent;
let customerAgent;
const createdPromoIds = [];

describe('admin promotional emails', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    const adminEmail = uniqueEmail('adminpromo');
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await pool.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Admin', ?, ?, 'admin', 1)",
      [businessId, adminEmail, passwordHash]
    );
    adminAgent = newAgent();
    await adminAgent.post('/api/auth/admin-login').send({ email: adminEmail, password: PASSWORD });

    customerAgent = newAgent();
    await customerAgent.post('/api/auth/register').send({ name: 'Test Customer', email: uniqueEmail('customerpromo'), password: PASSWORD });
  });

  after(async () => {
    if (createdPromoIds.length) {
      await pool.query(`DELETE FROM promotional_emails WHERE id IN (${createdPromoIds.map(() => '?').join(',')})`, createdPromoIds);
    }
    await pool.query("DELETE FROM newsletter_subscribers WHERE email LIKE 'test-%@example.com'");
    await cleanupTestUsers();
    await pool.end();
  });

  describe('GET /api/admin/promo-emails', () => {
    it('rejects a non-admin', async () => {
      const res = await customerAgent.get('/api/admin/promo-emails');
      assert.equal(res.status, 403);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request.get('/api/admin/promo-emails');
      assert.equal(res.status, 401);
    });

    it('lists promo emails for an admin', async () => {
      const res = await adminAgent.get('/api/admin/promo-emails');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });
  });

  describe('POST /api/admin/promo-emails', () => {
    it('rejects missing required fields', async () => {
      const res = await adminAgent.post('/api/admin/promo-emails').send({ title: 'No subject or message' });
      assert.equal(res.status, 400);
    });

    it('creates a draft promo email', async () => {
      const res = await adminAgent.post('/api/admin/promo-emails').send({
        title: 'Test Promo', subject: 'Big Sale', message: 'Everything is 20% off this week.',
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'draft');
      assert.equal(res.body.title, 'Test Promo');
      createdPromoIds.push(res.body.id);
    });
  });

  describe('PUT /api/admin/promo-emails/:id', () => {
    it('returns 404 for a nonexistent promo email', async () => {
      const res = await adminAgent.put('/api/admin/promo-emails/999999999').send({ title: 'Nope' });
      assert.equal(res.status, 404);
    });

    it('updates an existing promo email', async () => {
      const create = await adminAgent.post('/api/admin/promo-emails').send({
        title: 'Original Title', subject: 'Original Subject', message: 'Original message.',
      });
      createdPromoIds.push(create.body.id);

      const res = await adminAgent.put(`/api/admin/promo-emails/${create.body.id}`).send({ title: 'Updated Title' });
      assert.equal(res.status, 200);
      assert.equal(res.body.title, 'Updated Title');
      // Fields not included in the update keep their previous value.
      assert.equal(res.body.subject, 'Original Subject');
    });
  });

  describe('POST /api/admin/promo-emails/:id/send', () => {
    it('returns 404 for a nonexistent promo email', async () => {
      const res = await adminAgent.post('/api/admin/promo-emails/999999999/send');
      assert.equal(res.status, 404);
    });

    it('rejects sending when there are no active subscribers', async () => {
      const create = await adminAgent.post('/api/admin/promo-emails').send({
        title: 'No Subscribers Promo', subject: 'Hello', message: 'Nobody will get this.',
      });
      createdPromoIds.push(create.body.id);

      // Any subscriber left over from another test file must not count — unsubscribe it first.
      await pool.query('UPDATE newsletter_subscribers SET unsubscribed_at = NOW() WHERE business_id = ? AND unsubscribed_at IS NULL', [businessId]);

      const res = await adminAgent.post(`/api/admin/promo-emails/${create.body.id}/send`);
      assert.equal(res.status, 400);
    });

    it('sends to active subscribers and marks the promo as sent', async () => {
      const subscriberEmail = uniqueEmail('promosubscriber');
      await pool.query('INSERT INTO newsletter_subscribers (business_id, email) VALUES (?, ?)', [businessId, subscriberEmail]);

      const create = await adminAgent.post('/api/admin/promo-emails').send({
        title: 'Real Send Promo', subject: 'Hello Subscribers', message: 'Thanks for subscribing!',
      });
      createdPromoIds.push(create.body.id);

      const res = await adminAgent.post(`/api/admin/promo-emails/${create.body.id}/send`);
      assert.equal(res.status, 200);
      assert.equal(res.body.recipients, 1);

      const [[row]] = await pool.query('SELECT status, recipient_count FROM promotional_emails WHERE id = ?', [create.body.id]);
      assert.equal(row.status, 'sent');
      assert.equal(row.recipient_count, 1);

      await pool.query('DELETE FROM newsletter_subscribers WHERE email = ?', [subscriberEmail]);
    });
  });

  describe('DELETE /api/admin/promo-emails/:id', () => {
    it('returns 404 for a nonexistent promo email', async () => {
      const res = await adminAgent.delete('/api/admin/promo-emails/999999999');
      assert.equal(res.status, 404);
    });

    it('deletes an existing promo email', async () => {
      const create = await adminAgent.post('/api/admin/promo-emails').send({
        title: 'To Delete', subject: 'Bye', message: 'This will be deleted.',
      });

      const res = await adminAgent.delete(`/api/admin/promo-emails/${create.body.id}`);
      assert.equal(res.status, 200);

      const list = await adminAgent.get('/api/admin/promo-emails');
      assert.ok(!list.body.some((p) => p.id === create.body.id));
    });
  });
});
