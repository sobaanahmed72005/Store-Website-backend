import pool from '../config/db.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { logAudit } from '../utils/auditLog.js';

const DEFAULTS = {
  provider: 'Leopards Courier',
  enabled: false,
  api_key: '',
  api_password: '',
  tracking_url_template: 'https://leopardscourier.com/tracking/{tracking_number}',
  sandbox: true,
  default_weight_grams: 1000,
  origin_city: 'self',
  shipper_id: '',
};

const LEOPARDS_BASE_URL = {
  live: 'https://merchantapi.leopardscourier.com/api/',
  staging: 'https://merchantapistaging.leopardscourier.com/api/',
};

export async function adminGet(req, res) {
  const [rows] = await pool.query('SELECT * FROM courier_settings WHERE business_id = ?', [req.business.id]);
  if (rows.length === 0) return res.json({ ...DEFAULTS, has_api_key: false, has_api_password: false, api_key: undefined, api_password: undefined });
  const settings = { ...rows[0] };
  delete settings.business_id;
  delete settings.updated_at;
  const decryptedKey = decryptSecret(settings.api_key);
  const decryptedPassword = decryptSecret(settings.api_password);
  delete settings.api_key;
  delete settings.api_password;
  res.json({
    ...settings,
    enabled: Boolean(settings.enabled),
    sandbox: Boolean(settings.sandbox),
    shipper_id: settings.shipper_id ?? '',
    has_api_key: Boolean(decryptedKey),
    has_api_password: Boolean(decryptedPassword),
  });
}

export async function adminUpdate(req, res) {
  const { provider, enabled, api_key, api_password, tracking_url_template, sandbox, default_weight_grams, origin_city, shipper_id } = req.body;
  if (!tracking_url_template?.includes('{tracking_number}')) {
    return res.status(400).json({ error: 'Tracking URL template must include {tracking_number}' });
  }

  // Masked-field behavior: a blank submission keeps the existing secret.
  const existing = await getCourierSettings(req.business.id);
  const keyToSave = api_key || existing.api_key || null;
  const passwordToSave = api_password || existing.api_password || null;

  await pool.query(
    `INSERT INTO courier_settings (business_id, provider, enabled, api_key, api_password, tracking_url_template, sandbox, default_weight_grams, origin_city, shipper_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE provider = VALUES(provider), enabled = VALUES(enabled), api_key = VALUES(api_key),
       api_password = VALUES(api_password), tracking_url_template = VALUES(tracking_url_template),
       sandbox = VALUES(sandbox), default_weight_grams = VALUES(default_weight_grams),
       origin_city = VALUES(origin_city), shipper_id = VALUES(shipper_id)`,
    [
      req.business.id, provider || 'Leopards Courier', Number(Boolean(enabled)), encryptSecret(keyToSave), encryptSecret(passwordToSave), tracking_url_template,
      Number(Boolean(sandbox)), Number(default_weight_grams) || 1000, origin_city || 'self', shipper_id || null,
    ]
  );
  cityCache.delete(req.business.id);
  res.json({ message: 'Saved' });
  logAudit({
    req, action: 'courier_settings.update', entityType: 'courier_settings', entityId: req.business.id,
    details: { provider: provider || 'Leopards Courier', enabled: Boolean(enabled), sandbox: Boolean(sandbox), secrets_changed: Boolean(api_key || api_password) },
  });
}

export async function getCourierSettings(businessId) {
  const [rows] = await pool.query('SELECT * FROM courier_settings WHERE business_id = ?', [businessId]);
  if (rows.length === 0) return { ...DEFAULTS, enabled: false };
  return {
    ...rows[0],
    enabled: Boolean(rows[0].enabled),
    sandbox: Boolean(rows[0].sandbox),
    api_key: decryptSecret(rows[0].api_key),
    api_password: decryptSecret(rows[0].api_password),
  };
}

export function buildTrackingUrl(trackingNumber, template) {
  if (!trackingNumber || !template) return null;
  return template.replace('{tracking_number}', encodeURIComponent(trackingNumber));
}

// ── Leopards Courier "eCom Merchant API V2" client ──────────────────────────
// Field names below follow the Book a Packet / Track Booked Packet / Get All
// Cities sections of Leopards' merchant API docs. Defaults to their staging
// endpoint (courier_settings.sandbox = 1) so nothing books a real shipment
// until an admin explicitly flips it to production in Admin → Courier.

function isLeopardsProvider(provider) {
  return /leopards/i.test(provider || '');
}

async function leopardsRequest(settings, endpoint, params) {
  const base = settings.sandbox ? LEOPARDS_BASE_URL.staging : LEOPARDS_BASE_URL.live;
  const body = new URLSearchParams({
    api_key: settings.api_key || '',
    api_password: settings.api_password || '',
    ...params,
  });
  let res;
  try {
    res = await fetch(`${base}${endpoint}/format/json/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    throw new Error(`Could not reach Leopards Courier: ${err.message}`, { cause: err });
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Leopards returned an unexpected response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return data;
}

const cityCache = new Map(); // businessId -> { at, list }
const CITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getLeopardsCities(businessId, settings, forceRefresh = false) {
  const cached = cityCache.get(businessId);
  if (!forceRefresh && cached && Date.now() - cached.at < CITY_CACHE_TTL_MS) return cached.list;

  const data = await leopardsRequest(settings, 'getAllCities', {});
  const list = data.city_list || data.cities || [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(data.error || data.message || 'Leopards did not return a city list — check your API key/password.');
  }
  cityCache.set(businessId, { at: Date.now(), list });
  return list;
}

function findLeopardsCityMatch(cities, cityName) {
  if (!cityName) return null;
  const norm = cityName.trim().toLowerCase();
  return cities.find((c) => (c.name || c.city_name || '').trim().toLowerCase() === norm) || null;
}

export async function adminTestConnection(req, res) {
  try {
    const settings = await getCourierSettings(req.business.id);
    if (!settings.api_key || !settings.api_password) {
      return res.status(400).json({ error: 'Enter your API key and password first.' });
    }
    const cities = await getLeopardsCities(req.business.id, settings, true);
    res.json({
      message: `Connected to Leopards ${settings.sandbox ? 'staging' : 'production'} successfully — ${cities.length} cities available.`,
      sandbox: settings.sandbox,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// Books a real shipment (or a staging one, depending on courier_settings.sandbox).
// Throws with a message suitable for direct display to an admin on failure.
export async function bookLeopardsPacket(businessId, order) {
  const settings = await getCourierSettings(businessId);
  if (!settings.enabled) throw new Error('Leopards Courier is not enabled in Admin → Courier.');
  if (!settings.api_key || !settings.api_password) throw new Error('Leopards API key/password are not set in Admin → Courier.');

  const destinationCity = order.shipping_city?.trim();
  if (!destinationCity) throw new Error('This order has no shipping city set — cannot book with Leopards.');

  const cities = await getLeopardsCities(businessId, settings).catch(() => null);
  if (cities && !findLeopardsCityMatch(cities, destinationCity)) {
    throw new Error(`Leopards doesn't recognize the shipping city "${destinationCity}". Check the spelling on this order or book manually.`);
  }

  const params = {
    booked_packet_weight: String(settings.default_weight_grams || 1000),
    booked_packet_no_piece: '1',
    booked_packet_collect_amount: order.payment_method === 'cod' ? String(Math.round(Number(order.total_amount) || 0)) : '0',
    booked_packet_order_id: String(order.id),
    origin_city: settings.origin_city || 'self',
    destination_city: destinationCity,
    shipment_name_eng: 'self',
    shipment_email: 'self',
    shipment_phone: 'self',
    shipment_address: 'self',
    consignment_name: order.shipping_name || order.customer_name || 'Customer',
    consignment_email: order.email || order.customer_email || '',
    consignment_phone: order.phone || '',
    consignment_address: order.shipping_address || '',
    special_instructions: order.notes || '',
  };
  if (settings.shipper_id) params.shipment_id = settings.shipper_id;

  const data = await leopardsRequest(settings, 'bookPacket', params);
  const looksFailed = data.status === 0 || data.status === false || data.status === '0';
  const trackNumber = data.track_number || data.data?.track_number || data.packet_list?.[0]?.track_number;
  if (looksFailed || !trackNumber) {
    const errMsg = data.error || data.message || data.Error || JSON.stringify(data).slice(0, 300);
    throw new Error(`Leopards booking failed: ${errMsg}`);
  }
  return { trackNumber, slipLink: data.slip_link || data.data?.slip_link || null, raw: data };
}

// Tracks a batch of CN/track numbers, chunked to stay within Leopards' per-call limits.
export async function trackLeopardsPackets(businessId, trackNumbers) {
  if (trackNumbers.length === 0) return [];
  const settings = await getCourierSettings(businessId);
  if (!settings.enabled || !isLeopardsProvider(settings.provider) || !settings.api_key || !settings.api_password) return [];

  const data = await leopardsRequest(settings, 'trackBookedPacket', { track_numbers: trackNumbers.join(',') });
  return data.packet_list || data.data || [];
}

// Out-for-delivery is checked before the generic "deliver" pattern since
// "delivery" itself contains the substring "deliver".
const LEOPARDS_STATUS_MAP = [
  { match: /out\s*for\s*delivery/i, status: 'out_for_delivery' },
  { match: /deliver/i, status: 'delivered' },
  { match: /return/i, status: 'returned' },
  { match: /cancel/i, status: 'cancelled' },
];

export function mapLeopardsStatus(leopardsStatus) {
  if (!leopardsStatus) return null;
  for (const { match, status } of LEOPARDS_STATUS_MAP) {
    if (match.test(leopardsStatus)) return status;
  }
  return null;
}

export { isLeopardsProvider };
