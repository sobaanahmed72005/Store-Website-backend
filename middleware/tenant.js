import pool from '../config/db.js';
import { DEFAULT_STORE_SLUG, NODE_ENV } from '../config/env.js';

const BASE_HOSTS = ['localhost', '127.0.0.1'];

// In production, tenant identity is derived strictly from the real Host header a request
// actually arrived on — a caller can't claim to be a different store than the domain they
// connected to. X-Store-Slug is a development-only convenience for simulating multiple
// tenants locally without setting up real subdomain DNS.
function extractSlug(req) {
  // Single-store deployments set this so tenant resolution doesn't depend on guessing the
  // slug from whatever domain the request happened to arrive on (which breaks the moment the
  // frontend and backend live on different domains, e.g. yourdomain.com vs api.yourdomain.com).
  if (DEFAULT_STORE_SLUG) return DEFAULT_STORE_SLUG;

  if (NODE_ENV !== 'production') {
    const headerSlug = req.headers['x-store-slug'];
    if (headerSlug) return String(headerSlug).toLowerCase().trim();
  }

  const hostname = (req.hostname || '').toLowerCase();
  // Only a local-dev convenience (so http://127.0.0.1:5000 resolves instead of misparsing the
  // IP's dots as a subdomain) — gated to non-production for the same reason X-Store-Slug is
  // above: the Host header is caller-controlled, so honoring it in production would let anyone
  // who can reach the origin directly force resolution to the 'main' tenant.
  if (NODE_ENV !== 'production' && BASE_HOSTS.includes(hostname)) return 'main';

  const parts = hostname.split('.');
  if (parts.length > 1) return parts[0];

  return 'main';
}

export async function resolveBusiness(req, res, next) {
  const slug = extractSlug(req);

  try {
    const [rows] = await pool.query('SELECT id, name, slug, status FROM businesses WHERE slug = ?', [slug]);
    if (rows.length === 0 || rows[0].status !== 'active') {
      return res.status(404).json({ error: 'Store not found' });
    }
    req.business = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}