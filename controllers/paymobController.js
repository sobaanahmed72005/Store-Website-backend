import pool from '../config/db.js';
import { createHmac } from 'crypto';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { logAudit } from '../utils/auditLog.js';

// Pakistan-specific API host, confirmed against Paymob's own regional docs (docs.paymob.pk) and
// cross-checked against Paymob's official Postman collection (github.com/PaymobAccept/API-Postman-Collections).
// NOTE: could not confirm whether Paymob Pakistan has a separate staging/sandbox host, or whether
// "test mode" is purely a matter of which API keys (test vs live, issued from the same dashboard)
// you use against this one host. The `sandbox` flag below is currently informational only — it
// does not change the URL. Confirm with Paymob directly and adjust if they do provide a distinct
// staging host.
const BASE_URL = 'https://pakistan.paymob.com';

// The fixed, alphabetically-ordered field list Paymob HMAC-SHA512-signs for the "Transaction
// Processed Callback" (the server-to-server POST to notification_url) — cross-validated against
// Paymob's documented field list AND a real transaction object shape from a production
// integration package (both independently agree on this exact list and order).
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

async function getSettings(businessId) {
  const [rows] = await pool.query(
    'SELECT * FROM payment_gateways WHERE business_id = ? AND provider = ?',
    [businessId, 'paymob']
  );
  if (rows.length === 0) {
    return { enabled: false, sandbox: true, public_key: null, secret_key: null, hmac_secret: null, integration_ids: [] };
  }
  return {
    ...rows[0],
    enabled: Boolean(rows[0].enabled),
    sandbox: Boolean(rows[0].sandbox),
    public_key: decryptSecret(rows[0].api_key),
    secret_key: decryptSecret(rows[0].secret_key),
    hmac_secret: decryptSecret(rows[0].hmac_secret),
    integration_ids: rows[0].integration_ids
      ? rows[0].integration_ids.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
      : [],
  };
}

export async function adminGet(req, res) {
  const s = await getSettings(req.business.id);
  res.json({
    enabled: s.enabled,
    sandbox: s.sandbox,
    public_key: s.public_key || '',
    integration_ids: s.integration_ids.join(', '),
    has_secret: Boolean(s.secret_key),
    has_hmac_secret: Boolean(s.hmac_secret),
  });
}

export async function adminUpdate(req, res) {
  const { enabled, sandbox, public_key, secret_key, hmac_secret, integration_ids } = req.body;
  const existing = await getSettings(req.business.id);

  // Masked-field behavior (matches the pattern used for other gateways): a blank submission
  // for a secret keeps the existing stored value instead of wiping it.
  const secretToSave = secret_key || existing.secret_key || null;
  const hmacToSave = hmac_secret || existing.hmac_secret || null;
  const idsToSave = integration_ids != null
    ? String(integration_ids).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).join(',')
    : (existing.integration_ids.join(',') || null);

  await pool.query(
    `INSERT INTO payment_gateways (business_id, provider, enabled, sandbox, api_key, secret_key, hmac_secret, integration_ids)
     VALUES (?, 'paymob', ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled), sandbox = VALUES(sandbox), api_key = VALUES(api_key),
       secret_key = VALUES(secret_key), hmac_secret = VALUES(hmac_secret), integration_ids = VALUES(integration_ids)`,
    [
      req.business.id, Number(Boolean(enabled)), Number(Boolean(sandbox !== false)),
      encryptSecret(public_key), encryptSecret(secretToSave), encryptSecret(hmacToSave), idsToSave || null,
    ]
  );
  res.json({ message: 'Saved' });
  logAudit({
    req, action: 'payment_settings.update', entityType: 'payment_gateway', entityId: 'paymob',
    details: { enabled: Boolean(enabled), sandbox: sandbox !== false, secret_key_changed: Boolean(secret_key), hmac_secret_changed: Boolean(hmac_secret) },
  });
}

// Public — Checkout uses this to decide whether to show the Paymob option
export async function getEnabled(req, res) {
  const s = await getSettings(req.business.id);
  res.json({
    enabled: s.enabled && Boolean(s.public_key) && Boolean(s.secret_key) && Boolean(s.hmac_secret) && s.integration_ids.length > 0,
  });
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
  const order = orders[0];

  const settings = await getSettings(req.business.id);
  if (!settings.enabled || !settings.public_key || !settings.secret_key || settings.integration_ids.length === 0) {
    return res.status(400).json({ error: 'Paymob is not configured for this store' });
  }

  // Paymob expects the smallest currency unit (paisa: 1 PKR = 100 paisa) — confirmed by their
  // pervasive "amount_cents" field naming across every real example we cross-checked.
  const amountInPaisa = Math.round(Number(order.total_amount) * 100);

  const [firstName, ...lastNameParts] = (order.shipping_name || 'Customer').trim().split(/\s+/);
  const lastName = lastNameParts.join(' ') || 'Customer';

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const pmRes = await fetch(`${BASE_URL}/v1/intention/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${settings.secret_key}`,
    },
    body: JSON.stringify({
      amount: amountInPaisa,
      currency: 'PKR',
      payment_methods: settings.integration_ids,
      items: [{ name: `Order #${order_id}`, amount: amountInPaisa, description: `Order #${order_id}`, quantity: 1 }],
      billing_data: {
        first_name: firstName || 'Customer',
        last_name: lastName,
        phone_number: order.phone || 'NA',
        email: order.email || 'noemail@example.com',
        apartment: 'NA',
        street: order.shipping_address || 'NA',
        building: 'NA',
        city: order.shipping_city || 'NA',
        state: 'NA',
        country: 'PK',
        floor: 'NA',
      },
      // Echoed back as obj.order.merchant_order_id in the webhook — using the real order id
      // directly means the webhook can look the order up with no extra stored token column.
      special_reference: String(order_id),
      redirection_url: `${frontendUrl}/checkout/success?orderId=${order_id}`,
      // notification_url is deliberately NOT set here — Paymob calls the default webhook URL
      // configured against each Integration ID in the merchant dashboard. Set that to
      // https://<your-real-domain>/api/payments/paymob/webhook once deployed, for every
      // enabled integration ID.
    }),
  });

  if (!pmRes.ok) {
    const text = await pmRes.text();
    throw new Error(`Paymob API error ${pmRes.status}: ${text}`);
  }

  const data = await pmRes.json();
  const clientSecret = data?.client_secret;
  if (!clientSecret) throw new Error('Paymob did not return a client_secret');

  const checkoutUrl = `${BASE_URL}/unifiedcheckout/?publicKey=${settings.public_key}&clientSecret=${clientSecret}`;

  res.json({ checkoutUrl });
}

// Paymob calls this endpoint when a payment transaction is processed (the "Transaction
// Processed Callback"). Mounted BEFORE resolveBusiness in server.js — Paymob doesn't send
// store/tenant context, so the order lookup itself has to determine the business.
export async function webhook(req, res) {
  // Acknowledge immediately so Paymob doesn't retry.
  res.json({ received: true });

  try {
    const obj = req.body?.obj;
    const hmacFromPaymob = req.body?.hmac;
    if (!obj || !hmacFromPaymob) return;

    const orderId = Number(getNestedValue(obj, 'order.merchant_order_id'));
    if (!orderId) return;

    const [orders] = await pool.query("SELECT * FROM orders WHERE id = ? AND status = 'pending_payment'", [orderId]);
    if (orders.length === 0) return;
    const order = orders[0];

    // Verify HMAC signature — mandatory. special_reference (the order id) is visible in the
    // browser during checkout, so anyone who saw their own order id could otherwise forge a
    // "success" webhook for their own unpaid order. A missing or invalid signature must reject.
    const settings = await getSettings(order.business_id);
    if (!settings.hmac_secret) {
      console.error(`Paymob webhook received for order #${order.id} but no hmac_secret is configured — rejecting`);
      return;
    }

    // NOTE: booleans are concatenated as lowercase "true"/"false" here — this is the one detail
    // in this integration that couldn't be independently cross-validated with full certainty.
    // If signature verification fails against a real sandbox webhook, check this first.
    const concatenated = HMAC_FIELDS.map((field) => {
      const value = getNestedValue(obj, field);
      if (value === true) return 'true';
      if (value === false) return 'false';
      return value == null ? '' : String(value);
    }).join('');

    const expected = createHmac('sha512', settings.hmac_secret).update(concatenated).digest('hex');
    if (expected !== hmacFromPaymob) {
      console.error(`Paymob webhook signature mismatch for order #${order.id}`);
      return;
    }

    if (obj.success !== true || obj.pending === true) return;

    const reference = String(obj.id ?? '');
    await pool.query("UPDATE orders SET status = 'pending', payment_reference = ? WHERE id = ?", [reference, order.id]);
  } catch (err) {
    console.error('Paymob webhook error:', err);
  }
}
