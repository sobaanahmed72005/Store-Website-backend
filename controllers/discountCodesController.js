import pool from '../config/db.js';
import { logAudit } from '../utils/auditLog.js';

export async function resolveDiscount({ businessId, userId, code, subtotal, queryRunner = pool }) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    const err = new Error('A discount code is required');
    err.status = 400;
    throw err;
  }

  // FOR UPDATE locks the code's row for the life of the caller's transaction, so two concurrent
  // orders redeeming the same single-use code serialize here instead of both passing the
  // "already used" check below before either has committed its redemption row.
  const [rows] = await queryRunner.query('SELECT * FROM discount_codes WHERE business_id = ? AND code = ? FOR UPDATE', [businessId, normalizedCode]);
  if (rows.length === 0) {
    const err = new Error('Invalid discount code');
    err.status = 400;
    throw err;
  }

  const discount = rows[0];
  if (!discount.is_active) {
    const err = new Error('This discount code is no longer active');
    err.status = 400;
    throw err;
  }
  if (discount.expires_at && new Date(discount.expires_at) < new Date()) {
    const err = new Error('This discount code has expired');
    err.status = 400;
    throw err;
  }

  if (!discount.reusable) {
    const [redemptions] = await queryRunner.query(
      'SELECT id FROM discount_code_redemptions WHERE discount_code_id = ? AND user_id = ?',
      [discount.id, userId]
    );
    if (redemptions.length > 0) {
      const err = new Error('You have already used this discount code');
      err.status = 400;
      throw err;
    }
  }

  const rawAmount = discount.discount_type === 'percent'
    ? (subtotal * Number(discount.discount_value)) / 100
    : Number(discount.discount_value);
  const discountAmount = Math.round(Math.min(Math.max(rawAmount, 0), subtotal) * 100) / 100;

  return { discount, discountAmount };
}

export async function validateCode(req, res) {
  const { code, subtotal } = req.body;
  if (!code || subtotal == null) return res.status(400).json({ error: 'code and subtotal are required' });

  try {
    const { discount, discountAmount } = await resolveDiscount({
      businessId: req.business.id,
      userId: req.user.id,
      code,
      subtotal: Number(subtotal),
    });
    res.json({
      valid: true,
      code: discount.code,
      discount_type: discount.discount_type,
      discount_value: Number(discount.discount_value),
      discount_amount: discountAmount,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function adminList(req, res) {
  const [rows] = await pool.query('SELECT * FROM discount_codes WHERE business_id = ? ORDER BY created_at DESC', [req.business.id]);
  res.json(rows);
}

export async function adminCreate(req, res) {
  const { code, discount_type, discount_value, expires_at, reusable, is_active } = req.body;
  const numericValue = Number(discount_value);
  if (!code?.trim() || !['percent', 'fixed'].includes(discount_type) || discount_value == null || !Number.isFinite(numericValue)) {
    return res.status(400).json({ error: 'code, discount_type, and a numeric discount_value are required' });
  }
  if (discount_type === 'percent' && (numericValue <= 0 || numericValue > 100)) {
    return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
  }
  if (numericValue <= 0) {
    return res.status(400).json({ error: 'discount_value must be greater than 0' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO discount_codes (business_id, code, discount_type, discount_value, is_active, expires_at, reusable) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        req.business.id,
        code.trim().toUpperCase(),
        discount_type,
        numericValue,
        is_active === undefined ? 1 : Number(Boolean(is_active)),
        expires_at || null,
        Number(Boolean(reusable)),
      ]
    );
    res.status(201).json({ id: result.insertId });
    logAudit({
      req, action: 'discount_code.create', entityType: 'discount_code', entityId: result.insertId,
      details: { code: code.trim().toUpperCase(), discount_type, discount_value },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A code with that name already exists' });
    throw err;
  }
}

export async function adminUpdate(req, res) {
  const { is_active } = req.body;
  const [existing] = await pool.query('SELECT code, is_active FROM discount_codes WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Discount code not found' });

  await pool.query(
    'UPDATE discount_codes SET is_active = ? WHERE id = ? AND business_id = ?',
    [Number(Boolean(is_active)), req.params.id, req.business.id]
  );
  res.json({ message: 'Updated' });
  logAudit({
    req, action: 'discount_code.update', entityType: 'discount_code', entityId: req.params.id,
    details: { code: existing[0].code, is_active: { from: Boolean(existing[0].is_active), to: Boolean(is_active) } },
  });
}

export async function adminDelete(req, res) {
  const [existing] = await pool.query('SELECT code FROM discount_codes WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Discount code not found' });

  await pool.query('DELETE FROM discount_codes WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  res.json({ message: 'Deleted' });
  logAudit({ req, action: 'discount_code.delete', entityType: 'discount_code', entityId: req.params.id, details: { code: existing[0].code } });
}