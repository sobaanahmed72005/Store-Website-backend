import { FRONTEND_URL } from '../config/env.js';

export function buildStoreUrl(slug) {
  const base = FRONTEND_URL;
  // "main" is the reserved slug for the bare base domain (no subdomain) — see middleware/tenant.js's extractSlug.
  if (slug === 'main') return base;
  try {
    const url = new URL(base);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.hostname = `${slug}.localhost`;
    } else {
      url.hostname = `${slug}.${url.hostname}`;
    }
    return url.origin;
  } catch {
    return base;
  }
}