import pool from '../config/db.js';
import { buildStoreUrl } from '../utils/storeUrl.js';

const STATIC_PATHS = ['/', '/products', '/about-us', '/contact', '/return-exchange', '/privacy-policy'];

export async function getRobotsTxt(req, res) {
  const origin = buildStoreUrl(req.business.slug);
  const lines = [
    'User-agent: *',
    'Disallow: /platform/',
    'Disallow: /checkout',
    'Disallow: /cart',
    'Disallow: /account',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
  ];
  res.type('text/plain').send(lines.join('\n'));
}

export async function getSitemap(req, res) {
  const origin = buildStoreUrl(req.business.slug);
  const [categories] = await pool.query('SELECT slug FROM categories WHERE business_id = ?', [req.business.id]);
  const [products] = await pool.query('SELECT slug FROM products WHERE business_id = ?', [req.business.id]);

  const urls = [
    ...STATIC_PATHS.map((path) => `${origin}${path}`),
    ...categories.map((c) => `${origin}/category/${c.slug}`),
    ...products.map((p) => `${origin}/product/${p.slug}`),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((loc) => `  <url><loc>${loc}</loc></url>`).join('\n')}
</urlset>`;

  res.type('application/xml').send(body);
}