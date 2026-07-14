import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';

describe('auth', () => {
  after(async () => {
    await cleanupTestUsers();
    await pool.end();
  });

  describe('POST /api/auth/register', () => {
    it('creates a new customer account and starts a session', async () => {
      const email = uniqueEmail('register');
      const res = await request.post('/api/auth/register').send({ name: 'Test User', email, password: PASSWORD });

      assert.equal(res.status, 201);
      assert.equal(res.body.user.email, email);
      assert.equal(res.body.user.role, 'customer');
      assert.equal(res.body.user.email_verified, 0);
      assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('cz_token=')), 'sets an access token cookie');
      assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('cz_refresh=')), 'sets a refresh cookie');
    });

    it('rejects a duplicate email with 409', async () => {
      const email = uniqueEmail('dup');
      await request.post('/api/auth/register').send({ name: 'First', email, password: PASSWORD });

      const res = await request.post('/api/auth/register').send({ name: 'Second', email, password: PASSWORD });
      assert.equal(res.status, 409);
    });

    it('rejects a request missing required fields', async () => {
      const res = await request.post('/api/auth/register').send({ email: uniqueEmail('missing') });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with correct credentials', async () => {
      const email = uniqueEmail('login');
      await request.post('/api/auth/register').send({ name: 'Login Test', email, password: PASSWORD });

      const res = await request.post('/api/auth/login').send({ email, password: PASSWORD });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, email);
    });

    it('rejects an incorrect password', async () => {
      const email = uniqueEmail('wrongpass');
      await request.post('/api/auth/register').send({ name: 'Wrong Pass', email, password: PASSWORD });

      const res = await request.post('/api/auth/login').send({ email, password: 'not-the-real-password' });
      assert.equal(res.status, 401);
    });

    it('rejects a nonexistent email', async () => {
      const res = await request.post('/api/auth/login').send({ email: uniqueEmail('nobody'), password: PASSWORD });
      assert.equal(res.status, 401);
    });
  });

  // Regression coverage for the account-takeover fix: login/adminLogin share one code path
  // (authenticateUser) that treats a role mismatch identically to a wrong password, so an admin
  // account can't be probed or logged into through the customer endpoint and vice versa.
  describe('admin/customer role separation', () => {
    let adminEmail;

    before(async () => {
      // No public admin-registration endpoint by design — seed one directly, the same way
      // sql/init.js seeds the real store admin from ADMIN_EMAIL/ADMIN_PASSWORD.
      adminEmail = uniqueEmail('admin');
      const passwordHash = await bcrypt.hash(PASSWORD, 12);
      const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
      await pool.query(
        "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, 'Test Admin', ?, ?, 'admin', 1)",
        [business.id, adminEmail, passwordHash]
      );
    });

    it('an admin account cannot log in through the customer /login endpoint', async () => {
      const res = await request.post('/api/auth/login').send({ email: adminEmail, password: PASSWORD });
      assert.equal(res.status, 401);
    });

    it('an admin account can log in through /admin-login', async () => {
      const res = await request.post('/api/auth/admin-login').send({ email: adminEmail, password: PASSWORD });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, 'admin');
    });

    it('a customer account cannot log in through /admin-login', async () => {
      const email = uniqueEmail('notadmin');
      await request.post('/api/auth/register').send({ name: 'Not Admin', email, password: PASSWORD });

      const res = await request.post('/api/auth/admin-login').send({ email, password: PASSWORD });
      assert.equal(res.status, 401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('requires authentication', async () => {
      const res = await request.get('/api/auth/me');
      assert.equal(res.status, 401);
    });

    it('returns the logged-in user for a valid session', async () => {
      const agent = newAgent();
      const email = uniqueEmail('me');
      await agent.post('/api/auth/register').send({ name: 'Me Test', email, password: PASSWORD });

      const res = await agent.get('/api/auth/me');
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, email);
    });
  });

  // Regression coverage for the Critical account-takeover fix: changing the email used to
  // require no proof of identity, so a briefly-hijacked session (XSS, shared computer, leaked
  // cookie) could swap the email and take the account over via forgotPassword even after the
  // original session expired.
  describe('PUT /api/auth/me — email change requires the current password', () => {
    it('rejects an email change with no currentPassword', async () => {
      const agent = newAgent();
      const email = uniqueEmail('nopw');
      await agent.post('/api/auth/register').send({ name: 'No Password', email, password: PASSWORD });

      const res = await agent.put('/api/auth/me').send({ name: 'No Password', email: uniqueEmail('nopw-new') });
      assert.equal(res.status, 400);
    });

    it('rejects an email change with the wrong currentPassword', async () => {
      const agent = newAgent();
      const email = uniqueEmail('wrongpw');
      await agent.post('/api/auth/register').send({ name: 'Wrong Password', email, password: PASSWORD });

      const res = await agent.put('/api/auth/me').send({
        name: 'Wrong Password', email: uniqueEmail('wrongpw-new'), currentPassword: 'not-the-real-password',
      });
      assert.equal(res.status, 401);
    });

    it('allows an email change with the correct currentPassword, and resets email_verified', async () => {
      const agent = newAgent();
      const email = uniqueEmail('correctpw');
      await agent.post('/api/auth/register').send({ name: 'Correct Password', email, password: PASSWORD });

      const newEmail = uniqueEmail('correctpw-new');
      const res = await agent.put('/api/auth/me').send({ name: 'Correct Password', email: newEmail, currentPassword: PASSWORD });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, newEmail);
      assert.equal(res.body.user.email_verified, 0);
    });

    it('does not require a password when only the name changes', async () => {
      const agent = newAgent();
      const email = uniqueEmail('namechange');
      await agent.post('/api/auth/register').send({ name: 'Old Name', email, password: PASSWORD });

      const res = await agent.put('/api/auth/me').send({ name: 'New Name', email });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.name, 'New Name');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rejects a refresh with no session', async () => {
      const res = await newAgent().post('/api/auth/refresh');
      assert.equal(res.status, 401);
    });

    it('issues a usable session from the refresh cookie', async () => {
      const agent = newAgent();
      const email = uniqueEmail('refresh');
      await agent.post('/api/auth/register').send({ name: 'Refresh Test', email, password: PASSWORD });

      const res = await agent.post('/api/auth/refresh');
      assert.equal(res.status, 200);

      const me = await agent.get('/api/auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.body.user.email, email);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the session so subsequent authenticated requests fail', async () => {
      const agent = newAgent();
      const email = uniqueEmail('logout');
      await agent.post('/api/auth/register').send({ name: 'Logout Test', email, password: PASSWORD });

      const before = await agent.get('/api/auth/me');
      assert.equal(before.status, 200);

      await agent.post('/api/auth/logout');

      const after = await agent.get('/api/auth/me');
      assert.equal(after.status, 401);
    });
  });
});
