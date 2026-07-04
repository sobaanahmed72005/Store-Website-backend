import pool from '../config/db.js';
import { buildStoreUrl } from '../utils/storeUrl.js';

// /shop is the canonical all-products listing (see src/pages/Products.jsx); /products
// itself is a near-duplicate that canonicalizes to it, so it's excluded here.
const STATIC_PATHS = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/shop', changefreq: 'daily', priority: '0.9' },
  { path: '/about-us', changefreq: 'monthly', priority: '0.5' },
  { path: '/contact', changefreq: 'monthly', priority: '0.5' },
  { path: '/return-exchange', changefreq: 'monthly', priority: '0.3' },
  { path: '/privacy-policy', changefreq: 'monthly', priority: '0.3' },
];

export async function getRobotsTxt(req, res) {
  const origin = buildStoreUrl(req.business.slug);
  const adminPath = process.env.ADMIN_PATH || '/mgmt-8f2k1c';
  const lines = [
    'User-agent: *',
    `Disallow: ${adminPath}`,
    'Disallow: /checkout',
    'Disallow: /cart',
    'Disallow: /account',
    'Disallow: /signin',
    'Disallow: /signup',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
  ];
  res.type('text/plain').send(lines.join('\n'));
}

function formatLastmod(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export async function getSitemap(req, res) {
  const origin = buildStoreUrl(req.business.slug);
  const [categories] = await pool.query(
    'SELECT slug, updated_at, created_at FROM categories WHERE business_id = ?',
    [req.business.id]
  );
  const [products] = await pool.query(
    'SELECT slug, updated_at, created_at FROM products WHERE business_id = ?',
    [req.business.id]
  );

  const urls = [
    ...STATIC_PATHS.map(({ path, changefreq, priority }) => ({
      loc: `${origin}${path}`,
      lastmod: formatLastmod(new Date()),
      changefreq,
      priority,
    })),
    ...categories.map((c) => ({
      loc: `${origin}/category/${c.slug}`,
      lastmod: formatLastmod(c.updated_at || c.created_at),
      changefreq: 'weekly',
      priority: '0.7',
    })),
    ...products.map((p) => ({
      loc: `${origin}/product/${p.slug}`,
      lastmod: formatLastmod(p.updated_at || p.created_at),
      changefreq: 'weekly',
      priority: '0.8',
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
  )
  .join('\n')}
</urlset>`;

  res.type('application/xml').send(body);
}