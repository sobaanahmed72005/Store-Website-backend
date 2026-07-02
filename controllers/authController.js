import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailGreeting, emailButton, emailParagraph, emailDivider } from '../utils/emailTemplate.js';
import { getEmailTemplate, applyPlaceholders } from '../utils/emailLoader.js';

async function buildVerificationEmail(name, token, businessId) {
  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${token}`;
  const tpl = await getEmailTemplate(businessId, 'signup').catch(() => null);
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
    html: wrapEmail(body, { preheader: 'One click to activate your account.' }),
  };
}

async function buildPasswordResetEmail(name, token, businessId) {
  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
  const tpl = await getEmailTemplate(businessId, 'password_reset').catch(() => null);
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
    html: wrapEmail(body, { preheader: 'Reset your password.' }),
  };
}

export async function register(req, res) {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const [existing] = await pool.query('SELECT id FROM users WHERE business_id = ? AND email = ?', [req.business.id, email]);
  if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const [result] = await pool.query(
    'INSERT INTO users (business_id, name, email, password_hash, phone, verification_token) VALUES (?, ?, ?, ?, ?, ?)',
    [req.business.id, name, email, passwordHash, phone ?? null, verificationToken]
  );
  const user = { id: result.insertId, name, email, role: 'customer', email_verified: 0 };
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, business_id: req.business.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user });

  buildVerificationEmail(name, verificationToken, req.business.id).then(({ subject, html }) => {
    sendMail({ to: email, subject, html });
  }).catch(() => {});
}

export async function login(req, res) {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE business_id = ? AND email = ?', [req.business.id, email]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, business_id: req.business.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role, email_verified: user.email_verified,
      saved_phone: user.saved_phone || null,
      saved_address: user.saved_address || null,
      saved_city: user.saved_city || null,
    },
  });
}

export async function me(req, res) {
  res.json({ user: req.user });
}

export async function updateProfile(req, res) {
  const { name, email } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  try {
    await pool.query('UPDATE users SET name = ?, email = ? WHERE id = ?', [name.trim(), email.trim(), req.user.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }

  const user = { id: req.user.id, name: name.trim(), email: email.trim(), role: req.user.role, email_verified: req.user.email_verified };
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, business_id: req.business.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
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

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
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

  const passwordHash = await bcrypt.hash(newPassword, 10);
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
