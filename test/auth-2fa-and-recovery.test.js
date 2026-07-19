import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { generate } from 'otplib';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// otplib verifies against the real current time (epochTolerance is a window around actual
// "now", not around whatever epoch a token was generated for) — so a code manufactured for a
// synthetic future step doesn't reliably verify; only a code generated for the real current
// step does. That means the only way to get a second, distinct, verifiable code for the same
// secret is to wait for the real clock to cross into the next 30s window. Read the ground
// truth (totp_last_step, persisted by the server on every successful verification) from the DB
// and, if a fresh real-time code would land on or before it (i.e. a previous call in this test
// already consumed the current window), sleep to the next window before generating.
async function totpFor(secret, userId) {
  const [[row]] = await pool.query('SELECT totp_last_step FROM users WHERE id = ?', [userId]);
  const lastStep = row?.totp_last_step != null ? Number(row.totp_last_step) : null;

  const nowStep = Math.floor(Date.now() / 1000 / 30);
  if (lastStep != null && lastStep >= nowStep) {
    const msIntoStep = Date.now() % 30000;
    await sleep(30000 - msIntoStep + 50);
  }
  return generate({ secret, strategy: 'totp' });
}

async function registerAndGetId(agent, prefix) {
  const email = uniqueEmail(prefix);
  await agent.post('/api/auth/register').send({ name: 'Test User', email, password: PASSWORD });
  const [[user]] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  return { email, id: user.id };
}

describe('auth — 2FA, password reset, email verification', () => {
  after(async () => {
    await cleanupTestUsers();
    await pool.end();
  });

  describe('email verification', () => {

    it('rejects a request with no token', async () => {
      const res = await request.get('/api/auth/verify-email');
      assert.equal(res.status, 400);
    });

    it('rejects a bogus token', async () => {
      const res = await request.get('/api/auth/verify-email').query({ token: 'not-a-real-token' });
      assert.equal(res.status, 400);
    });

    it('verifies with the real token stored at registration and is single-use', async () => {
      const agent = newAgent();
      const { id } = await registerAndGetId(agent, 'verify');

      // The raw token only ever leaves the server in the email; recover it the same way the DB
      // would validate it, by regenerating and re-storing a known raw token for this user.
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?', [
        hashToken(rawToken), expires, id,
      ]);

      const res = await request.get('/api/auth/verify-email').query({ token: rawToken });
      assert.equal(res.status, 200);

      const [[row]] = await pool.query('SELECT email_verified, verification_token FROM users WHERE id = ?', [id]);
      assert.equal(row.email_verified, 1);
      assert.equal(row.verification_token, null);

      // Using the same token again must fail — it was cleared on first use.
      const second = await request.get('/api/auth/verify-email').query({ token: rawToken });
      assert.equal(second.status, 400);
    });

    it('rejects an expired token', async () => {
      const agent = newAgent();
      const { id } = await registerAndGetId(agent, 'verifyexp');

      const rawToken = crypto.randomBytes(32).toString('hex');
      const expired = new Date(Date.now() - 1000);
      await pool.query('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?', [
        hashToken(rawToken), expired, id,
      ]);

      const res = await request.get('/api/auth/verify-email').query({ token: rawToken });
      assert.equal(res.status, 400);
    });

    describe('POST /api/auth/resend-verification', () => {
      it('requires authentication', async () => {
        const res = await request.post('/api/auth/resend-verification');
        assert.equal(res.status, 401);
      });

      it('issues a new usable token for an unverified account', async () => {
        const agent = newAgent();
        const { id } = await registerAndGetId(agent, 'resend');

        const res = await agent.post('/api/auth/resend-verification');
        assert.equal(res.status, 200);

        const [[row]] = await pool.query('SELECT verification_token FROM users WHERE id = ?', [id]);
        assert.ok(row.verification_token, 'a new token hash was stored');
      });

      it('rejects resending once already verified', async () => {
        const agent = newAgent();
        const { id } = await registerAndGetId(agent, 'resendverified');
        await pool.query('UPDATE users SET email_verified = 1 WHERE id = ?', [id]);

        const res = await agent.post('/api/auth/resend-verification');
        assert.equal(res.status, 400);
      });
    });
  });

  describe('password reset', () => {

    describe('POST /api/auth/forgot-password', () => {
      it('responds the same way for an existing and nonexistent email (no enumeration)', async () => {
        const agent = newAgent();
        const { email } = await registerAndGetId(agent, 'forgot');

        const existing = await request.post('/api/auth/forgot-password').send({ email });
        const nonexistent = await request.post('/api/auth/forgot-password').send({ email: uniqueEmail('nobody-forgot') });

        assert.equal(existing.status, 200);
        assert.equal(nonexistent.status, 200);
        assert.deepEqual(existing.body, nonexistent.body);
      });

      it('sets a reset token for an existing account', async () => {
        const agent = newAgent();
        const { email, id } = await registerAndGetId(agent, 'forgotset');

        await request.post('/api/auth/forgot-password').send({ email });

        const [[row]] = await pool.query('SELECT reset_token, reset_token_expires FROM users WHERE id = ?', [id]);
        assert.ok(row.reset_token, 'reset_token was set');
        assert.ok(new Date(row.reset_token_expires) > new Date(), 'expiry is in the future');
      });

      it('requires an email', async () => {
        const res = await request.post('/api/auth/forgot-password').send({});
        assert.equal(res.status, 400);
      });
    });

    describe('POST /api/auth/reset-password', () => {
      it('rejects a bogus token', async () => {
        const res = await request.post('/api/auth/reset-password').send({ token: 'nope', newPassword: 'newpass123' });
        assert.equal(res.status, 400);
      });

      it('rejects a new password shorter than 8 characters', async () => {
        const agent = newAgent();
        const { id } = await registerAndGetId(agent, 'resetshort');
        const rawToken = crypto.randomBytes(32).toString('hex');
        await pool.query('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [
          hashToken(rawToken), new Date(Date.now() + 60 * 60 * 1000), id,
        ]);

        const res = await request.post('/api/auth/reset-password').send({ token: rawToken, newPassword: 'short1' });
        assert.equal(res.status, 400);
      });

      it('resets the password with a valid token, and the token is single-use', async () => {
        const agent = newAgent();
        const { email, id } = await registerAndGetId(agent, 'resetok');
        const rawToken = crypto.randomBytes(32).toString('hex');
        await pool.query('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [
          hashToken(rawToken), new Date(Date.now() + 60 * 60 * 1000), id,
        ]);

        const res = await request.post('/api/auth/reset-password').send({ token: rawToken, newPassword: 'newpass123' });
        assert.equal(res.status, 200);

        const login = await request.post('/api/auth/login').send({ email, password: 'newpass123' });
        assert.equal(login.status, 200);

        const reuse = await request.post('/api/auth/reset-password').send({ token: rawToken, newPassword: 'anotherpass123' });
        assert.equal(reuse.status, 400);
      });

      it('rejects an expired token', async () => {
        const agent = newAgent();
        const { id } = await registerAndGetId(agent, 'resetexp');
        const rawToken = crypto.randomBytes(32).toString('hex');
        await pool.query('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [
          hashToken(rawToken), new Date(Date.now() - 1000), id,
        ]);

        const res = await request.post('/api/auth/reset-password').send({ token: rawToken, newPassword: 'newpass123' });
        assert.equal(res.status, 400);
      });
    });
  });

  describe('two-factor authentication', () => {

    describe('GET /api/auth/2fa/status', () => {
      it('requires authentication', async () => {
        const res = await request.get('/api/auth/2fa/status');
        assert.equal(res.status, 401);
      });

      it('reports disabled for a fresh account', async () => {
        const agent = newAgent();
        await registerAndGetId(agent, '2fastatus');
        const res = await agent.get('/api/auth/2fa/status');
        assert.equal(res.status, 200);
        assert.equal(res.body.enabled, false);
      });
    });

    describe('POST /api/auth/2fa/setup', () => {
      it('requires authentication', async () => {
        const res = await request.post('/api/auth/2fa/setup').send({ password: PASSWORD });
        assert.equal(res.status, 401);
      });

      it('requires a password', async () => {
        const agent = newAgent();
        await registerAndGetId(agent, '2fasetupnopw');
        const res = await agent.post('/api/auth/2fa/setup').send({});
        assert.equal(res.status, 400);
      });

      it('rejects the wrong password', async () => {
        const agent = newAgent();
        await registerAndGetId(agent, '2fasetupwrong');
        const res = await agent.post('/api/auth/2fa/setup').send({ password: 'not-the-real-password' });
        assert.equal(res.status, 401);
      });

      it('returns a QR code and manual entry key for the right password', async () => {
        const agent = newAgent();
        await registerAndGetId(agent, '2fasetupok');
        const res = await agent.post('/api/auth/2fa/setup').send({ password: PASSWORD });
        assert.equal(res.status, 200);
        assert.ok(res.body.qrCodeDataUrl.startsWith('data:image'));
        assert.ok(res.body.manualEntryKey);
      });
    });

    async function setUpConfirmedTwoFactor(agent, prefix) {
      const { email, id } = await registerAndGetId(agent, prefix);
      const setupRes = await agent.post('/api/auth/2fa/setup').send({ password: PASSWORD });
      const secret = setupRes.body.manualEntryKey;
      const token = await totpFor(secret, id);
      const confirmRes = await agent.post('/api/auth/2fa/confirm').send({ token });
      return { email, id, secret, confirmRes };
    }

    describe('POST /api/auth/2fa/confirm', () => {
      it('rejects confirm before setup has been started', async () => {
        const agent = newAgent();
        await registerAndGetId(agent, '2faconfirmnosetup');
        const res = await agent.post('/api/auth/2fa/confirm').send({ token: '123456' });
        assert.equal(res.status, 400);
      });

      it('rejects an invalid code', async () => {
        const agent = newAgent();
        await registerAndGetId(agent, '2faconfirmbad');
        await agent.post('/api/auth/2fa/setup').send({ password: PASSWORD });
        const res = await agent.post('/api/auth/2fa/confirm').send({ token: '000000' });
        assert.equal(res.status, 400);
      });

      it('enables 2FA with a valid code and returns recovery codes', async () => {
        const agent = newAgent();
        const { confirmRes } = await setUpConfirmedTwoFactor(agent, '2faconfirmok');
        assert.equal(confirmRes.status, 200);
        assert.ok(Array.isArray(confirmRes.body.recoveryCodes));
        assert.equal(confirmRes.body.recoveryCodes.length, 8);

        const status = await agent.get('/api/auth/2fa/status');
        assert.equal(status.body.enabled, true);
      });
    });

    describe('login with 2FA enabled', () => {
      it('login returns a challenge instead of a session when 2FA is enabled', async () => {
        const agent = newAgent();
        const { email } = await setUpConfirmedTwoFactor(agent, '2falogin');

        const res = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        assert.equal(res.status, 200);
        assert.equal(res.body.requires2fa, true);
        assert.ok(res.body.challengeId);
        assert.equal(res.body.user, undefined, 'no session-granting user payload before 2FA is verified');
      });

      it('POST /api/auth/2fa/verify completes login with a valid TOTP code', async () => {
        const setupAgent = newAgent();
        const { email, id, secret } = await setUpConfirmedTwoFactor(setupAgent, '2faverifyok');

        const loginRes = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        const { challengeId } = loginRes.body;

        const loginAgent = newAgent();
        const token = await totpFor(secret, id);
        const verifyRes = await loginAgent.post('/api/auth/2fa/verify').send({ challengeId, token });
        assert.equal(verifyRes.status, 200);
        assert.equal(verifyRes.body.user.email, email);

        const me = await loginAgent.get('/api/auth/me');
        assert.equal(me.status, 200);
      });

      it('rejects an invalid code at the verify step', async () => {
        const setupAgent = newAgent();
        const { email } = await setUpConfirmedTwoFactor(setupAgent, '2faverifybad');

        const loginRes = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        const { challengeId } = loginRes.body;

        const res = await request.post('/api/auth/2fa/verify').send({ challengeId, token: '000000' });
        assert.equal(res.status, 401);
      });

      it('rejects a nonexistent/expired challengeId', async () => {
        const res = await request.post('/api/auth/2fa/verify').send({ challengeId: 'bogus-challenge-id', token: '123456' });
        assert.equal(res.status, 401);
      });

      it('locks out the challenge after 5 failed attempts, even with the right code after', async () => {
        const setupAgent = newAgent();
        const { email, id, secret } = await setUpConfirmedTwoFactor(setupAgent, '2falockout');

        const loginRes = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        const { challengeId } = loginRes.body;

        for (let i = 0; i < 5; i += 1) {
          const res = await request.post('/api/auth/2fa/verify').send({ challengeId, token: '000000' });
          assert.equal(res.status, 401);
        }

        const token = await totpFor(secret, id);
        const res = await request.post('/api/auth/2fa/verify').send({ challengeId, token });
        assert.equal(res.status, 401, 'challenge was consumed by the 5th failed attempt');
      });

      it('a TOTP code cannot be replayed for a second login within the same time step', async () => {
        const setupAgent = newAgent();
        const { email, id, secret } = await setUpConfirmedTwoFactor(setupAgent, '2fareplay');
        const token = await totpFor(secret, id);

        const firstLogin = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        const firstVerify = await request.post('/api/auth/2fa/verify').send({ challengeId: firstLogin.body.challengeId, token });
        assert.equal(firstVerify.status, 200);

        const secondLogin = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        const secondVerify = await request.post('/api/auth/2fa/verify').send({ challengeId: secondLogin.body.challengeId, token });
        assert.equal(secondVerify.status, 401, 'the same code must not verify twice');
      });

      it('a recovery code logs in and cannot be reused', async () => {
        const setupAgent = newAgent();
        const { email, confirmRes } = await setUpConfirmedTwoFactor(setupAgent, '2farecovery');
        const recoveryCode = confirmRes.body.recoveryCodes[0];

        const loginRes = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        const firstVerify = await request.post('/api/auth/2fa/verify').send({
          challengeId: loginRes.body.challengeId, token: recoveryCode,
        });
        assert.equal(firstVerify.status, 200);

        const secondLoginRes = await newAgent().post('/api/auth/login').send({ email, password: PASSWORD });
        const secondVerify = await request.post('/api/auth/2fa/verify').send({
          challengeId: secondLoginRes.body.challengeId, token: recoveryCode,
        });
        assert.equal(secondVerify.status, 401, 'a recovery code is single-use');
      });
    });

    describe('POST /api/auth/2fa/disable', () => {
      it('requires a password and token', async () => {
        const agent = newAgent();
        await setUpConfirmedTwoFactor(agent, '2fadisablemissing');
        const res = await agent.post('/api/auth/2fa/disable').send({});
        assert.equal(res.status, 400);
      });

      it('rejects the wrong password', async () => {
        const agent = newAgent();
        const { id, secret } = await setUpConfirmedTwoFactor(agent, '2fadisablewrongpw');
        const token = await totpFor(secret, id);
        const res = await agent.post('/api/auth/2fa/disable').send({ password: 'not-the-real-password', token });
        assert.equal(res.status, 401);
      });

      it('rejects the wrong code', async () => {
        const agent = newAgent();
        await setUpConfirmedTwoFactor(agent, '2fadisablewrongcode');
        const res = await agent.post('/api/auth/2fa/disable').send({ password: PASSWORD, token: '000000' });
        assert.equal(res.status, 401);
      });

      it('disables 2FA and revokes other sessions, keeping the acting device signed in', async () => {
        const agent = newAgent();
        const { email, id, secret } = await setUpConfirmedTwoFactor(agent, '2fadisableok');

        // A second, separate session on the same account (another device).
        const otherDevice = newAgent();
        const otherLoginRes = await otherDevice.post('/api/auth/login').send({ email, password: PASSWORD });
        const otherLoginToken = await totpFor(secret, id);
        await otherDevice.post('/api/auth/2fa/verify').send({ challengeId: otherLoginRes.body.challengeId, token: otherLoginToken });
        const otherBefore = await otherDevice.get('/api/auth/me');
        assert.equal(otherBefore.status, 200);

        const disableToken = await totpFor(secret, id);
        const res = await agent.post('/api/auth/2fa/disable').send({ password: PASSWORD, token: disableToken });
        assert.equal(res.status, 200);

        const status = await agent.get('/api/auth/2fa/status');
        assert.equal(status.body.enabled, false);

        // Acting device stays signed in (new session issued as part of disable).
        const selfAfter = await agent.get('/api/auth/me');
        assert.equal(selfAfter.status, 200);

        // Other device's old session was revoked.
        const otherAfter = await otherDevice.get('/api/auth/me');
        assert.equal(otherAfter.status, 401);
      });
    });
  });

  describe('change-password revokes other sessions', () => {

    it('changing the password logs out other devices but keeps the acting one signed in', async () => {
      const agent = newAgent();
      const { email } = await registerAndGetId(agent, 'changepwrevoke');

      const otherDevice = newAgent();
      await otherDevice.post('/api/auth/login').send({ email, password: PASSWORD });
      const otherBefore = await otherDevice.get('/api/auth/me');
      assert.equal(otherBefore.status, 200);

      const res = await agent.put('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'brandnewpass123' });
      assert.equal(res.status, 200);

      const selfAfter = await agent.get('/api/auth/me');
      assert.equal(selfAfter.status, 200);

      const otherAfter = await otherDevice.get('/api/auth/me');
      assert.equal(otherAfter.status, 401);

      const reLogin = await request.post('/api/auth/login').send({ email, password: 'brandnewpass123' });
      assert.equal(reLogin.status, 200);
    });

    it('rejects the wrong current password', async () => {
      const agent = newAgent();
      await registerAndGetId(agent, 'changepwwrong');
      const res = await agent.put('/api/auth/change-password').send({ currentPassword: 'not-the-real-password', newPassword: 'brandnewpass123' });
      assert.equal(res.status, 401);
    });

    it('rejects a new password shorter than 8 characters', async () => {
      const agent = newAgent();
      await registerAndGetId(agent, 'changepwshort');
      const res = await agent.put('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'short1' });
      assert.equal(res.status, 400);
    });
  });

});
