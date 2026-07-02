import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { buildStoreUrl } from '../utils/storeUrl.js';

const RESERVED_SLUGS = ['main', 'www', 'api', 'admin', 'app', 'mail', 'ftp', 'support', 'help', 'static', 'assets', 'cdn', 'platform'];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function normalizeSlug(raw) {
  return String(raw || '').toLowerCase().trim();
}

function validateSlug(slug) {
  if (!slug || slug.length < 3 || slug.length > 63) return 'Subdomain must be 3-63 characters';
  if (!SLUG_PATTERN.test(slug)) return 'Subdomain can only contain lowercase letters, numbers, and hyphens';
  if (RESERVED_SLUGS.includes(slug)) return 'That subdomain is reserved, please choose another';
  return null;
}

export async function login(req, res) {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM platform_admins WHERE email = ?', [email]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const admin = rows[0];
  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: admin.id, email: admin.email, type: 'platform' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
}

export async function me(req, res) {
  res.json({ admin: req.platformAdmin });
}

export async function updateProfile(req, res) {
  const { name, email } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  try {
    await pool.query('UPDATE platform_admins SET name = ?, email = ? WHERE id = ?', [name.trim(), email.trim(), req.platformAdmin.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }

  const admin = { id: req.platformAdmin.id, name: name.trim(), email: email.trim() };
  const token = jwt.sign({ id: admin.id, email: admin.email, type: 'platform' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, admin });
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const [rows] = await pool.query('SELECT password_hash FROM platform_admins WHERE id = ?', [req.platformAdmin.id]);
  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE platform_admins SET password_hash = ? WHERE id = ?', [passwordHash, req.platformAdmin.id]);
  res.json({ message: 'Password updated' });
}

export async function checkSlug(req, res) {
  const slug = normalizeSlug(req.query.slug);
  const error = validateSlug(slug);
  if (error) return res.json({ available: false, error });

  const [rows] = await pool.query('SELECT id FROM businesses WHERE slug = ?', [slug]);
  res.json({ available: rows.length === 0 });
}

export async function listBusinesses(req, res) {
  const [rows] = await pool.query(`
    SELECT b.id, b.name, b.slug, b.status, b.created_at,
           u.name AS admin_name, u.email AS admin_email,
           (SELECT COUNT(*) FROM products p WHERE p.business_id = b.id) AS product_count
    FROM businesses b
    LEFT JOIN users u ON u.id = b.owner_user_id
    ORDER BY b.created_at DESC
  `);
  res.json(rows.map((row) => ({ ...row, storeUrl: buildStoreUrl(row.slug) })));
}

export async function createBusiness(req, res) {
  const businessName = String(req.body.businessName || '').trim();
  const slug = normalizeSlug(req.body.slug);
  const adminName = String(req.body.adminName || '').trim();
  const adminEmail = String(req.body.adminEmail || '').trim().toLowerCase();
  const adminPassword = req.body.adminPassword || '';

  if (!businessName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'businessName, slug, adminName, adminEmail and adminPassword are required' });
  }

  const slugError = validateSlug(slug);
  if (slugError) return res.status(400).json({ error: slugError });

  if (adminPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const [existingSlug] = await pool.query('SELECT id FROM businesses WHERE slug = ?', [slug]);
  if (existingSlug.length > 0) return res.status(409).json({ error: 'That subdomain is already taken' });

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [businessResult] = await connection.query('INSERT INTO businesses (name, slug) VALUES (?, ?)', [businessName, slug]);
    const businessId = businessResult.insertId;

    const [userResult] = await connection.query(
      "INSERT INTO users (business_id, name, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 'admin', 1)",
      [businessId, adminName, adminEmail, passwordHash]
    );

    await connection.query('UPDATE businesses SET owner_user_id = ? WHERE id = ?', [userResult.insertId, businessId]);

    await connection.commit();

    const storeUrl = buildStoreUrl(slug);
    res.status(201).json({
      business: { id: businessId, name: businessName, slug, status: 'active', storeUrl },
      admin: { id: userResult.insertId, name: adminName, email: adminEmail },
    });

    const adminPath = process.env.ADMIN_PATH || '/mgmt-8f2k1c';
    const adminLoginUrl = `${storeUrl}${adminPath}/login`;
    sendMail({
      to: adminEmail,
      subject: 'Your store is ready',
      html: `
        <p>Hi ${adminName},</p>
        <p>Your store "${businessName}" has been created. You can sign in to manage it at:</p>
        <p><a href="${adminLoginUrl}">${adminLoginUrl}</a></p>
        <p>Email: ${adminEmail}</p>
      `,
    });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function setBusinessStatus(req, res) {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const [result] = await pool.query('UPDATE businesses SET status = ? WHERE id = ?', [status, req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Business not found' });
  res.json({ message: 'Business updated' });
}
