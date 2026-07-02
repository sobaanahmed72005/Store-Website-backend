import pool from '../config/db.js';
import { createHmac } from 'crypto';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

// NOTE: verify these base URLs against Safepay's official docs when onboarding
const SANDBOX_BASE = 'https://sandbox.api.getsafepay.com';
const PROD_BASE = 'https://api.getsafepay.com';

function baseUrl(sandbox) {
  return sandbox ? SANDBOX_BASE : PROD_BASE;
}

async function getSettings(businessId) {
  const [rows] = await pool.query(
    'SELECT * FROM payment_gateways WHERE business_id = ? AND provider = ?',
    [businessId, 'safepay']
  );
  if (rows.length === 0) return { enabled: false, sandbox: true, api_key: null, secret_key: null };
  return {
    ...rows[0],
    enabled: Boolean(rows[0].enabled),
    sandbox: Boolean(rows[0].sandbox),
    api_key: decryptSecret(rows[0].api_key),
    secret_key: decryptSecret(rows[0].secret_key),
  };
}

export async function adminGet(req, res) {
  const s = await getSettings(req.business.id);
  res.json({
    enabled: s.enabled,
    sandbox: s.sandbox,
    api_key: s.api_key || '',
    has_secret: Boolean(s.secret_key),
  });
}

export async function adminUpdate(req, res) {
  const { enabled, sandbox, api_key, secret_key } = req.body;
  const existing = await getSettings(req.business.id);
  // Don't overwrite an existing secret_key if none submitted (masked field behaviour)
  const secretToSave = secret_key || existing.secret_key || null;

  await pool.query(
    `INSERT INTO payment_gateways (business_id, provider, enabled, sandbox, api_key, secret_key)
     VALUES (?, 'safepay', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled), sandbox = VALUES(sandbox),
       api_key = VALUES(api_key), secret_key = VALUES(secret_key)`,
    [req.business.id, Number(Boolean(enabled)), Number(Boolean(sandbox !== false)), encryptSecret(api_key), encryptSecret(secretToSave)]
  );
  res.json({ message: 'Saved' });
}

// Public — Checkout uses this to decide whether to show the Safepay option
export async function getEnabled(req, res) {
  const s = await getSettings(req.business.id);
  res.json({ enabled: s.enabled && Boolean(s.api_key) && Boolean(s.secret_key) });
}

// Called after the order is created with status='pending_payment'
export async function createSession(req, res) {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const [orders] = await pool.query(
    'SELECT * FROM orders WHERE id = ? AND business_id = ? AND user_id = ? AND status = ?',
    [order_id, req.business.id, req.user.id, 'pending_payment']
  );
  if (orders.length === 0) return res.status(404).json({ error: 'Order not found or already paid' });

  const settings = await getSettings(req.business.id);
  if (!settings.enabled || !settings.api_key || !settings.secret_key) {
    return res.status(400).json({ error: 'Safepay is not configured for this store' });
  }

  // Safepay expects the smallest currency unit (paisa: 1 PKR = 100 paisa)
  // NOTE: verify this with Safepay docs — some gateways use whole units
  const amountInPaisa = Math.round(Number(orders[0].total_amount) * 100);

  const sfpyRes = await fetch(`${baseUrl(settings.sandbox)}/order/v1/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.api_key}`,
      'X-SFPY-SECRET': settings.secret_key,
    },
    body: JSON.stringify({
      environment: settings.sandbox ? 'sandbox' : 'production',
      order: {
        currency: 'PKR',
        amount: amountInPaisa,
        order_id: String(order_id),
      },
    }),
  });

  if (!sfpyRes.ok) {
    const text = await sfpyRes.text();
    throw new Error(`Safepay API error ${sfpyRes.status}: ${text}`);
  }

  const data = await sfpyRes.json();
  const token = data?.data?.tracker?.token;
  if (!token) throw new Error('Safepay did not return a tracker token');

  // Store token so webhook can look up this order
  await pool.query('UPDATE orders SET safepay_token = ? WHERE id = ?', [token, order_id]);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const env = settings.sandbox ? 'sandbox' : 'production';
  const successUrl = encodeURIComponent(`${frontendUrl}/checkout/success?orderId=${order_id}`);
  const cancelUrl = encodeURIComponent(`${frontendUrl}/checkout/cancelled?orderId=${order_id}`);

  const checkoutUrl =
    `${baseUrl(settings.sandbox)}/checkout/pay?tbt=${token}&env=${env}&source=custom` +
    `&redirect_url=${successUrl}&cancel_url=${cancelUrl}`;

  res.json({ checkoutUrl });
}

// Safepay calls this endpoint when a payment is completed
// Mounted BEFORE resolveBusiness in server.js — Safepay doesn't send store context
export async function webhook(req, res) {
  // Acknowledge immediately so Safepay doesn't retry
  res.json({ received: true });

  try {
    const tracker = req.body?.data?.tracker;
    if (!tracker?.token) return;
    if (tracker.state !== 'PAID') return;

    // Look up order globally by safepay_token
    const [orders] = await pool.query(
      "SELECT * FROM orders WHERE safepay_token = ? AND status = 'pending_payment'",
      [tracker.token]
    );
    if (orders.length === 0) return;

    const order = orders[0];

    // Verify HMAC signature — mandatory. The safepay_token is visible to the browser (it's part of
    // the checkout redirect URL), so anyone who saw their own checkout URL could otherwise forge a
    // "PAID" webhook for their own unpaid order. A missing or invalid signature must reject the call.
    // NOTE: verify the exact header name against Safepay's webhook docs
    const sig = req.headers['sfpy-signature'] || req.headers['x-sfpy-signature'];
    const s = await getSettings(order.business_id);
    if (!s.secret_key) {
      console.error(`Safepay webhook received for order #${order.id} but no secret_key is configured — rejecting`);
      return;
    }
    if (!sig) {
      console.error(`Safepay webhook missing signature header for order #${order.id} — rejecting`);
      return;
    }
    const expected = createHmac('sha256', s.secret_key)
      .update(req.rawBody || JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      console.error(`Safepay webhook signature mismatch for order #${order.id}`);
      return;
    }

    // Payment confirmed — move to pending (admin still confirms shipping)
    const reference = tracker.reference || tracker.token;
    await pool.query(
      "UPDATE orders SET status = 'pending', payment_reference = ? WHERE id = ?",
      [reference, order.id]
    );
  } catch (err) {
    console.error('Safepay webhook error:', err);
  }
}