import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailGreeting, emailButton, emailParagraph, emailDivider } from '../utils/emailTemplate.js';
import { getEmailTemplate, applyPlaceholders } from '../utils/emailLoader.js';
import { getSiteName } from './contentController.js';
import { REFRESH_COOKIE, setAuthCookies, clearAuthCookies } from '../utils/authCookies.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { generateTotpSecret, verifyTotpToken, buildOtpAuthQrCode, generateRecoveryCodes } from '../utils/totp.js';
import { createChallengeStore } from '../utils/challengeStore.js';
import { createSession, revokeSession, revokeAllSessions } from '../utils/sessions.js';
import { JWT_SECRET, FRONTEND_URL } from '../config/env.js';

const BCRYPT_ROUNDS = 12;
const loginChallenges = createChallengeStore();

function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role, email_verified: user.email_verified,
    saved_phone: user.saved_phone || null,
    saved_address: user.saved_address || null,
    saved_city: user.saved_city || null,
  };
}

function issueSession(res, user, businessId, sessionId) {
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, business_id: businessId, session_id: sessionId },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
  setAuthCookies(res, token, sessionId);
}

async function verifyTwoFactorCode(user, rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return false;

  const secret = decryptSecret(user.totp_secret);
  if (secret && (await verifyTotpToken(secret, token))) return true;

  if (!user.totp_recovery_codes) return false;
  const hashes = JSON.parse(user.totp_recovery_codes);
  for (let i = 0; i < hashes.length; i += 1) {
    if (await bcrypt.compare(token.toUpperCase(), hashes[i])) {
      hashes.splice(i, 1);
      await pool.query('UPDATE users SET totp_recovery_codes = ? WHERE id = ?', [JSON.stringify(hashes), user.id]);
      return true;
    }
  }
  return false;
}

async function buildVerificationEmail(name, token, businessId) {
  const link = `${FRONTEND_URL}/verify-email?token=${token}`;
  const [tpl, storeName] = await Promise.all([
    getEmailTemplate(businessId, 'signup').catch(() => null),
    getSiteName(businessId),
  ]);
  const vars = { name };
  const subject = tpl?.subject ? applyPlaceholders(tpl.subject, vars) : 'Verify your email address';
  const message = tpl?.message ? applyPlaceholders(tpl.message, vars) : 'Thanks for creating an account with us! To get started, please verify your email address by clicking the button below.';
  const body =
    emailGreeting(name) +
    emailParagraph(message) +
    emailButton('Verify My Email', link) +
    emailDivider() +
    emailParagraph(`Or copy and paste this link into your browser:<br/><a href="${link}" style="color:#102b53;font-size:13px;">${link}</a>`) +
    emailParagraph("<span style='color:#888;font-size:13px;'>If you didn't create an account, you can safely ignore this email.</span>");
  return {
    subject,
    html: wrapEmail(body, { storeName, preheader: 'One click to activate your account.' }),
  };
}

async function buildPasswordResetEmail(name, token, businessId) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  const [tpl, storeName] = await Promise.all([
    getEmailTemplate(businessId, 'password_reset').catch(() => null),
    getSiteName(businessId),
  ]);
  const vars = { name };
  const subject = tpl?.subject ? applyPlaceholders(tpl.subject, vars) : 'Reset your password';
  const message = tpl?.message
    ? applyPlaceholders(tpl.message, vars)
    : 'We received a request to reset your password. Click the button below to choose a new one. If you did not request this, you can safely ignore this email — your password will not be changed.';
  const body =
    emailGreeting(name) +
    emailParagraph(message) +
    emailButton('Reset My Password', link) +
    emailDivider() +
    emailParagraph(`Or copy and paste this link into your browser:<br/><a href="${link}" style="color:#102b53;font-size:13px;">${link}</a>`) +
    emailParagraph("<span style='color:#888;font-size:13px;'>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</span>");
  return {
    subject,
    html: wrapEmail(body, { storeName, preheader: 'Reset your password.' }),
  };
}

export async function register(req, res) {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const [existing] = await pool.query('SELECT id FROM users WHERE business_id = ? AND email = ?', [req.business.id, email]);
  if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const [result] = await pool.query(
    'INSERT INTO users (business_id, name, email, password_hash, phone, verification_token) VALUES (?, ?, ?, ?, ?, ?)',
    [req.business.id, name, email, passwordHash, phone ?? null, verificationToken]
  );
  const user = { id: result.insertId, name, email, role: 'customer', email_verified: 0 };
  const sessionId = await createSession(user.id);
  issueSession(res, user, req.business.id, sessionId);
  res.status(201).json({ user });

  buildVerificationEmail(name, verificationToken, req.business.id).then(({ subject, html }) => {
    sendMail({ to: email, subject, html });
  }).catch(() => {});
}

// Shared by the customer and admin login endpoints, which must stay fully separate:
// an admin account can't authenticate through the customer endpoint and vice versa,
// so a role mismatch is treated identically to a wrong password.
async function authenticateUser(req, res, requiredRole) {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE business_id = ? AND email = ?', [req.business.id, email]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid || user.role !== requiredRole) return res.status(401).json({ error: 'Invalid credentials' });

  if (user.totp_enabled) {
    const challengeId = loginChallenges.create({ userId: user.id, businessId: req.business.id });
    return res.json({ requires2fa: true, challengeId });
  }

  const sessionId = await createSession(user.id);
  issueSession(res, user, req.business.id, sessionId);
  res.json({ user: publicUser(user) });
}

export async function login(req, res) {
  return authenticateUser(req, res, 'customer');
}

export async function adminLogin(req, res) {
  return authenticateUser(req, res, 'admin');
}

export async function verifyTwoFactorLogin(req, res) {
  const { challengeId, token } = req.body;
  if (!challengeId || !token) return res.status(400).json({ error: 'challengeId and token are required' });

  const challenge = loginChallenges.get(challengeId);
  if (!challenge) return res.status(401).json({ error: 'This code has expired. Please sign in again.' });
  if (challenge.businessId !== req.business.id) {
    loginChallenges.consume(challengeId);
    return res.status(401).json({ error: 'This code has expired. Please sign in again.' });
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND business_id = ?', [challenge.userId, challenge.businessId]);
  const user = rows[0];
  if (!user || !user.totp_enabled) {
    loginChallenges.consume(challengeId);
    return res.status(401).json({ error: 'Two-factor authentication is not enabled for this account' });
  }

  if (!(await verifyTwoFactorCode(user, token))) {
    loginChallenges.recordFailure(challengeId);
    return res.status(401).json({ error: 'Invalid code' });
  }

  loginChallenges.consume(challengeId);
  const sessionId = await createSession(user.id);
  issueSession(res, user, challenge.businessId, sessionId);
  res.json({ user: publicUser(user) });
}

export async function me(req, res) {
  // req.user is only the JWT payload (id/name/email/role/business_id) — requireAuth no longer
  // hits the DB on every request, so the fuller profile is fetched here instead, on this one
  // lower-frequency endpoint.
  const [rows] = await pool.query(
    'SELECT id, name, email, role, email_verified, saved_phone, saved_address, saved_city, totp_enabled FROM users WHERE id = ? AND business_id = ?',
    [req.user.id, req.business.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ user: rows[0] });
}

export async function refresh(req, res) {
  // The refresh cookie is just the session id itself (see utils/sessions.js / authCookies.js)
  // — this is the one DB round-trip per ~15-minute access-token lifetime that replaces what
  // used to be a query on every single authenticated request.
  const sessionId = req.cookies?.[REFRESH_COOKIE];
  if (!sessionId) return res.status(401).json({ error: 'Not signed in' });

  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.business_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked_at IS NULL`,
    [sessionId]
  );
  if (rows.length === 0) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }

  const user = rows[0];
  if (user.business_id !== req.business.id) {
    return res.status(401).json({ error: 'Invalid session for this store' });
  }

  issueSession(res, user, user.business_id, sessionId);
  res.json({ message: 'Refreshed' });
}

export async function logout(req, res) {
  // Revokes only this one session (device), not every session on the account — logging
  // out on a phone shouldn't also sign the same user out of their laptop. Reads the session
  // id straight from the refresh cookie rather than decoding the access token, since the
  // access token is often already expired (15-minute lifetime) by the time someone logs out.
  const sessionId = req.cookies?.[REFRESH_COOKIE];
  if (sessionId) await revokeSession(sessionId).catch(() => {});
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
}

export async function twoFactorStatus(req, res) {
  const [rows] = await pool.query('SELECT totp_enabled FROM users WHERE id = ?', [req.user.id]);
  res.json({ enabled: Boolean(rows[0]?.totp_enabled) });
}

export async function setupTwoFactor(req, res) {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required' });

  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const secret = generateTotpSecret();
  await pool.query('UPDATE users SET totp_secret = ? WHERE id = ?', [encryptSecret(secret), req.user.id]);
  const qrCodeDataUrl = await buildOtpAuthQrCode(req.user.email, secret, 'Store Admin');
  res.json({ qrCodeDataUrl, manualEntryKey: secret });
}

export async function confirmTwoFactor(req, res) {
  const { token } = req.body;
  const [rows] = await pool.query('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
  const secret = decryptSecret(rows[0]?.totp_secret);
  if (!secret) return res.status(400).json({ error: 'Start two-factor setup first' });
  if (!(await verifyTotpToken(secret, token))) {
    return res.status(400).json({ error: 'Invalid code — check your authenticator app and try again' });
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await Promise.all(recoveryCodes.map((code) => bcrypt.hash(code, BCRYPT_ROUNDS)));
  await pool.query('UPDATE users SET totp_enabled = 1, totp_recovery_codes = ? WHERE id = ?', [JSON.stringify(hashed), req.user.id]);
  res.json({ message: 'Two-factor authentication enabled', recoveryCodes });
}

export async function disableTwoFactor(req, res) {
  const { password, token } = req.body;
  if (!password || !token) return res.status(400).json({ error: 'password and token are required' });

  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  if (!(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  if (!(await verifyTwoFactorCode(user, token))) {
    return res.status(401).json({ error: 'Invalid code' });
  }

  await pool.query(
    'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery_codes = NULL WHERE id = ?',
    [req.user.id]
  );
  // Unlike a plain logout, this revokes *every* session on the account — 2FA being turned
  // off is exactly the kind of event where any other device holding a valid session token
  // should be forced to re-authenticate. The device making this request gets a fresh
  // session immediately after, so the person taking this action isn't logged out of it.
  await revokeAllSessions(req.user.id);
  const sessionId = await createSession(req.user.id);
  issueSession(res, req.user, req.business.id, sessionId);
  res.json({ message: 'Two-factor authentication disabled' });
}

export async function updateProfile(req, res) {
  const { name, email, currentPassword } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  const [existingRows] = await pool.query('SELECT email, password_hash FROM users WHERE id = ?', [req.user.id]);
  const emailChanged = email.trim() !== existingRows[0].email;

  // Changing the email is enough on its own to hijack the account via forgotPassword, so it
  // requires proving the current password — unlike the name, which is low-stakes on its own.
  if (emailChanged) {
    if (!currentPassword) return res.status(400).json({ error: 'currentPassword is required to change your email' });
    if (!(await bcrypt.compare(currentPassword, existingRows[0].password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  const verificationToken = emailChanged ? crypto.randomBytes(32).toString('hex') : null;
  try {
    await pool.query(
      emailChanged
        ? 'UPDATE users SET name = ?, email = ?, email_verified = 0, verification_token = ? WHERE id = ?'
        : 'UPDATE users SET name = ? WHERE id = ?',
      emailChanged ? [name.trim(), email.trim(), verificationToken, req.user.id] : [name.trim(), req.user.id]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }

  const [rows] = await pool.query('SELECT email_verified FROM users WHERE id = ?', [req.user.id]);
  const user = { id: req.user.id, name: name.trim(), email: email.trim(), role: req.user.role, email_verified: rows[0]?.email_verified };
  // Just refreshing the cookie's payload (name/email may have changed) — reuse the same
  // session rather than minting a new one, since nothing here needs to be revoked.
  issueSession(res, user, req.business.id, req.sessionId);
  res.json({ user });

  if (emailChanged) {
    buildVerificationEmail(name.trim(), verificationToken, req.business.id).then(({ subject, html }) => {
      sendMail({ to: email.trim(), subject, html });
    }).catch(() => {});
  }
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
  // Revokes every session for this account (including a stolen token on another device)
  // the moment the password changes — then immediately issues a fresh session for the
  // device making this request, so changing your own password doesn't log you out too.
  await revokeAllSessions(req.user.id);
  const sessionId = await createSession(req.user.id);
  issueSession(res, req.user, req.business.id, sessionId);
  res.json({ message: 'Password updated' });
}

export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const [rows] = await pool.query('SELECT id, name, email FROM users WHERE business_id = ? AND email = ?', [req.business.id, email]);
  // Always respond the same way regardless of whether the email exists, to avoid leaking which emails are registered.
  if (rows.length > 0) {
    const user = rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [resetToken, expires, user.id]);

    buildPasswordResetEmail(user.name, resetToken, req.business.id).then(({ subject, html }) => {
      sendMail({ to: user.email, subject, html });
    }).catch(() => {});
  }
  res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
}

export async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'token and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const [rows] = await pool.query(
    'SELECT id FROM users WHERE business_id = ? AND reset_token = ? AND reset_token_expires > NOW()',
    [req.business.id, token],
  );
  if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset link' });

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query(
    'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
    [passwordHash, rows[0].id],
  );
  res.json({ message: 'Password reset successfully' });
}

export async function verifyEmail(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const [rows] = await pool.query('SELECT id FROM users WHERE business_id = ? AND verification_token = ?', [req.business.id, token]);
  if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired verification link' });

  await pool.query('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?', [rows[0].id]);
  res.json({ message: 'Email verified' });
}

export async function resendVerification(req, res) {
  const [rows] = await pool.query('SELECT name, email, email_verified FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });

  const verificationToken = crypto.randomBytes(32).toString('hex');
  await pool.query('UPDATE users SET verification_token = ? WHERE id = ?', [verificationToken, req.user.id]);

  const { subject, html } = await buildVerificationEmail(user.name, verificationToken, req.business.id);
  await sendMail({ to: user.email, subject, html });
  res.json({ message: 'Verification email sent' });
}
