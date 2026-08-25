import pool from '../config/db.js';
import { buildStoreUrl } from '../utils/storeUrl.js';
import { ADMIN_PATH } from '../config/env.js';

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
  const lines = [
    'User-agent: *',
    `Disallow: ${ADMIN_PATH}`,
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
    `Sitemap: ${origin}/products-feed.xml`,
  ];
  res.type('text/plain').send(lines.join('\n'));
}

function formatLastmod(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>?/gm, '')
    .trim();
}

// The sitemap protocol itself caps a single file at 50,000 URLs — bounding the query at that same
// number keeps this from becoming an unbounded full-table scan as the catalog grows, and ORDER BY
// keeps the most recently updated products in the (extremely unlikely) truncated set.
const SITEMAP_URL_LIMIT = 50000;

export async function getSitemap(req, res) {
  const origin = buildStoreUrl(req.business.slug);
  const [categories] = await pool.query(
    'SELECT slug, updated_at, created_at FROM categories WHERE business_id = ? ORDER BY updated_at DESC LIMIT ?',
    [req.business.id, SITEMAP_URL_LIMIT]
  );
  const [products] = await pool.query(
    'SELECT slug, updated_at, created_at FROM products WHERE business_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT ?',
    [req.business.id, SITEMAP_URL_LIMIT]
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

export async function getProductsFeedXml(req, res) {
  const origin = buildStoreUrl(req.business.slug);
  const [products] = await pool.query(
    `SELECT p.id, p.name, p.slug, p.description, p.brand, p.price, p.discount_price, p.is_on_sale, p.stock, p.image, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.business_id = ? AND p.is_active = 1
     ORDER BY p.updated_at DESC LIMIT ?`,
    [req.business.id, SITEMAP_URL_LIMIT]
  );

  const itemsXml = products.map((p) => {
    const title = escapeXml(p.name);
    const rawDesc = stripHtml(p.description) || p.name;
    const description = escapeXml(rawDesc.slice(0, 5000));
    const link = escapeXml(`${origin}/product/${p.slug}`);
    const rawImageLink = p.image
      ? (p.image.startsWith('http') ? p.image : `${origin}${p.image.startsWith('/') ? '' : '/'}${p.image}`)
      : `${origin}/icon.png`;
    const imageLink = escapeXml(rawImageLink);
    const availability = Number(p.stock) > 0 ? 'in_stock' : 'out_of_stock';
    const regularPrice = `${Number(p.price || 0).toFixed(2)} PKR`;
    const isOnSale = Boolean(p.is_on_sale) && p.discount_price != null && Number(p.discount_price) < Number(p.price);
    const salePrice = isOnSale ? `${Number(p.discount_price).toFixed(2)} PKR` : null;
    const brand = escapeXml(p.brand || req.business.name || 'IT Solutions');
    const category = p.category_name ? escapeXml(p.category_name) : null;

    let itemStr = `    <item>
      <g:id>${p.id}</g:id>
      <title>${title}</title>
      <description>${description}</description>
      <link>${link}</link>
      <g:image_link>${imageLink}</g:image_link>
      <g:availability>${availability}</g:availability>
      <g:price>${regularPrice}</g:price>`;

    if (salePrice) {
      itemStr += `\n      <g:sale_price>${salePrice}</g:sale_price>`;
    }

    itemStr += `\n      <g:brand>${brand}</g:brand>`;
    itemStr += `\n      <g:condition>new</g:condition>`;

    if (category) {
      itemStr += `\n      <g:product_type>${category}</g:product_type>`;
    }

    itemStr += `\n    </item>`;
    return itemStr;
  });

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(req.business.name || 'IT Solutions')} Product Feed</title>
    <link>${origin}</link>
    <description>Automated Google Merchant Center Product Feed</description>
${itemsXml.join('\n')}
  </channel>
</rss>`;

  res.type('application/xml').send(body);
}