export function buildStoreUrl(slug) {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
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