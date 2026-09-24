import pool from '../config/db.js';
import { buildStoreUrl } from '../utils/storeUrl.js';

// In-memory cache: 5 minutes TTL, max 500 items
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const prerenderCache = new Map();

function getCachedPrerender(key) {
  const entry = prerenderCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    prerenderCache.delete(key);
    return null;
  }
  return entry.html;
}

function setCachedPrerender(key, html) {
  if (prerenderCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = prerenderCache.keys().next().value;
    if (oldestKey) prerenderCache.delete(oldestKey);
  }
  prerenderCache.set(key, {
    html,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPriceValidUntil() {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (endOfMonth.getDate() - now.getDate() < 3) {
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const y = endOfNextMonth.getFullYear();
    const m = String(endOfNextMonth.getMonth() + 1).padStart(2, '0');
    const d = String(endOfNextMonth.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const y = endOfMonth.getFullYear();
  const m = String(endOfMonth.getMonth() + 1).padStart(2, '0');
  const d = String(endOfMonth.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function extractSkuFromProduct(product) {
  if (!product) return 'ITS-PROD';

  if (product.sku && String(product.sku).trim() && String(product.sku).trim() !== String(product.id)) {
    return String(product.sku).trim();
  }

  const isModelKey = (key) => {
    if (!key) return false;
    const k = String(key).trim().toLowerCase();
    return (
      k === 'model' ||
      k === 'model number' ||
      k === 'model no' ||
      k === 'model no.' ||
      k === 'model #' ||
      k === 'mpn' ||
      k === 'part number' ||
      k === 'part no' ||
      k === 'part #' ||
      k === 'sku' ||
      k === 'product code' ||
      k.includes('model number') ||
      k.includes('part number')
    );
  };

  const specs = Array.isArray(product.specifications)
    ? product.specifications
    : Array.isArray(product.specs)
    ? product.specs
    : [];

  for (const s of specs) {
    const key = s.attribute || s.attribute_name || s.label || s.name || s.key;
    if (isModelKey(key) && s.value && String(s.value).trim()) {
      return String(s.value).trim();
    }
  }

  if (Array.isArray(product.spec_overrides)) {
    for (const o of product.spec_overrides) {
      if (isModelKey(o.attribute_name) && o.value && String(o.value).trim()) {
        return String(o.value).trim();
      }
    }
  }

  const cat = product.category_name ? product.category_name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() : 'ITS';
  return `${cat}-${product.id || 'PROD'}`;
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveImageUrl(image, origin) {
  if (!image) return `${origin}/og-image.jpg`;
  if (image.startsWith('http://') || image.startsWith('https://')) return image;
  if (image.startsWith('/')) return `${origin}${image}`;
  return `${origin}/${image}`;
}

function getGoogleVerificationTag() {
  const token = process.env.GOOGLE_SITE_VERIFICATION;
  if (!token) return '';
  return `<meta name="google-site-verification" content="${escapeHtml(token)}">`;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export async function prerenderPage(req, res) {
  const rawPath = String(req.query.path || '/').trim();
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const businessId = req.business?.id || 1;
  const origin = buildStoreUrl(req.business?.slug || 'main');
  const cacheKey = `${businessId}:${path}`;

  const cached = getCachedPrerender(cacheKey);
  if (cached) {
    return res.type('text/html; charset=utf-8').send(cached);
  }

  try {
    let html = '';

    if (path === '/' || path === '') {
      html = await renderHome(businessId, origin);
    } else if (path === '/shop') {
      html = await renderShop(businessId, origin);
    } else if (path.startsWith('/product/')) {
      const slug = path.replace('/product/', '').split('?')[0].split('#')[0];
      if (!SLUG_PATTERN.test(slug)) {
        return res.status(404).type('text/html; charset=utf-8').send(render404(origin, 'Product not found'));
      }
      html = await renderProduct(businessId, slug, origin);
    } else if (path.startsWith('/category/')) {
      const slug = path.replace('/category/', '').split('?')[0].split('#')[0];
      if (!SLUG_PATTERN.test(slug)) {
        return res.status(404).type('text/html; charset=utf-8').send(render404(origin, 'Category not found'));
      }
      html = await renderCategory(businessId, slug, origin);
    } else if (path === '/blog') {
      html = await renderBlogList(businessId, origin);
    } else if (path.startsWith('/blog/')) {
      const slug = path.replace('/blog/', '').split('?')[0].split('#')[0];
      if (!SLUG_PATTERN.test(slug)) {
        return res.status(404).type('text/html; charset=utf-8').send(render404(origin, 'Post not found'));
      }
      html = await renderBlogPost(businessId, slug, origin);
    } else if (['/about-us', '/contact', '/return-exchange', '/privacy-policy'].includes(path)) {
      html = await renderCmsPage(businessId, path, origin);
    } else {
      return res.status(404).type('text/html; charset=utf-8').send(render404(origin, 'Page not found'));
    }

    if (!html) {
      return res.status(404).type('text/html; charset=utf-8').send(render404(origin, 'Page not found'));
    }

    setCachedPrerender(cacheKey, html);
    res.type('text/html; charset=utf-8').send(html);
  } catch (err) {
    (req.log || console).error({ err, path }, 'Prerender error');
    res.status(500).type('text/html; charset=utf-8').send(render404(origin, 'Error generating page'));
  }
}

async function renderProduct(businessId, slug, origin) {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug 
     FROM products p 
     LEFT JOIN categories c ON p.category_id = c.id 
     WHERE p.business_id = ? AND p.slug = ? AND p.is_active = 1`,
    [businessId, slug]
  );

  if (rows.length === 0) return null;
  const product = rows[0];

  const [specs] = await pool.query(
    `SELECT label, value FROM product_specs WHERE product_id = ? AND variant_id IS NULL ORDER BY sort_order, id`,
    [product.id]
  );

  const [attrSpecs] = await pool.query(
    `SELECT a.name AS attribute, o.value
     FROM product_attribute_values pav
     JOIN category_attribute_options o ON o.id = pav.option_id
     JOIN category_attributes a ON a.id = o.attribute_id
     WHERE pav.product_id = ?`,
    [product.id]
  );

  const allSpecs = [
    ...specs.map((s) => ({ name: s.label, value: s.value })),
    ...attrSpecs.map((s) => ({ name: s.attribute, value: s.value })),
  ];

  const canonicalUrl = `${origin}/product/${product.slug}`;
  const imageUrl = resolveImageUrl(product.image, origin);
  const plainDesc = stripHtml(product.description || '');
  const metaDesc = escapeHtml(
    plainDesc.slice(0, 160) || `Buy ${product.name} at IT Solutions Pakistan. Official warranty, cash on delivery nationwide.`
  );
  const pageTitle = escapeHtml(`${product.name} — Buy Online in Pakistan | IT Solutions`);

  const effectivePrice = product.is_on_sale && product.discount_price ? product.discount_price : product.price;
  const formattedPrice = Number(effectivePrice).toLocaleString('en-PK');
  const inStock = product.stock > 0;

  const [reviews] = await pool.query(
    `SELECT author_name, rating, comment, created_at
     FROM product_reviews
     WHERE business_id = ? AND product_id = ? AND status = 'approved'
     ORDER BY created_at DESC
     LIMIT 10`,
    [businessId, product.id]
  );

  const jsonLdProduct = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: [imageUrl],
    description: plainDesc.slice(0, 300),
    sku: extractSkuFromProduct(product),
    mpn: extractSkuFromProduct(product),
    brand: {
      '@type': 'Brand',
      name: product.brand || 'IT Solutions',
    },
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      priceCurrency: 'PKR',
      price: String(effectivePrice),
      priceValidUntil: getPriceValidUntil(),
      itemCondition: 'https://schema.org/NewCondition',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'Organization',
        name: 'IT Solutions Trade & Service Pvt. Ltd.',
      },
      shippingDetails: [
        {
          '@type': 'OfferShippingDetails',
          shippingRate: {
            '@type': 'MonetaryAmount',
            value: '0',
            currency: 'PKR',
          },
          shippingDestination: {
            '@type': 'DefinedRegion',
            addressCountry: 'PK',
          },
          deliveryTime: {
            '@type': 'ShippingDeliveryTime',
            handlingTime: {
              '@type': 'QuantitativeValue',
              minValue: 1,
              maxValue: 2,
              unitCode: 'DAY',
            },
            transitTime: {
              '@type': 'QuantitativeValue',
              minValue: 1,
              maxValue: 5,
              unitCode: 'DAY',
            },
          },
        },
        {
          '@type': 'OfferShippingDetails',
          shippingRate: {
            '@type': 'MonetaryAmount',
            value: '180',
            currency: 'PKR',
          },
          shippingDestination: {
            '@type': 'DefinedRegion',
            addressCountry: 'PK',
          },
          deliveryTime: {
            '@type': 'ShippingDeliveryTime',
            handlingTime: {
              '@type': 'QuantitativeValue',
              minValue: 1,
              maxValue: 2,
              unitCode: 'DAY',
            },
            transitTime: {
              '@type': 'QuantitativeValue',
              minValue: 1,
              maxValue: 5,
              unitCode: 'DAY',
            },
          },
        },
      ],
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'PK',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 7,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/ReturnShippingFeesCustomerPaying',
      },
    },
  };

  if (reviews.length > 0) {
    const totalRating = reviews.reduce((sum, r) => sum + Number(r.rating || 5), 0);
    const avgRating = Number((totalRating / reviews.length).toFixed(1));

    jsonLdProduct.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: avgRating,
      reviewCount: reviews.length,
    };

    jsonLdProduct.review = reviews.map((r) => ({
      '@type': 'Review',
      author: {
        '@type': 'Person',
        name: escapeHtml(r.author_name || 'Verified Buyer'),
      },
      datePublished: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      reviewRating: {
        '@type': 'Rating',
        ratingValue: Number(r.rating) || 5,
        bestRating: 5,
        worstRating: 1,
      },
      ...(r.comment ? { reviewBody: escapeHtml(stripHtml(r.comment)) } : {}),
    }));
  }

  const jsonLdBreadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
      ...(product.category_name
        ? [
            {
              '@type': 'ListItem',
              position: 2,
              name: product.category_name,
              item: `${origin}/category/${product.category_slug}`,
            },
            { '@type': 'ListItem', position: 3, name: product.name, item: canonicalUrl },
          ]
        : [{ '@type': 'ListItem', position: 2, name: product.name, item: canonicalUrl }]),
    ],
  };

  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDesc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="product">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="product:price:amount" content="${effectivePrice}">
  <meta property="product:price:currency" content="PKR">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${metaDesc}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <script type="application/ld+json">${JSON.stringify(jsonLdProduct)}</script>
  <script type="application/ld+json">${JSON.stringify(jsonLdBreadcrumbs)}</script>
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a>
      ${product.category_name ? ` › <a href="${origin}/category/${escapeHtml(product.category_slug)}">${escapeHtml(product.category_name)}</a>` : ''}
      › <span>${escapeHtml(product.name)}</span>
    </nav>
  </header>
  <main>
    <article>
      <h1>${escapeHtml(product.name)}</h1>
      ${product.brand ? `<p><strong>Brand:</strong> ${escapeHtml(product.brand)}</p>` : ''}
      <p><strong>Price:</strong> PKR ${formattedPrice} ${product.is_on_sale ? `<s>PKR ${Number(product.price).toLocaleString('en-PK')}</s> (On Sale)` : ''}</p>
      <p><strong>Availability:</strong> ${inStock ? 'In Stock' : 'Out of Stock'}</p>
      <div>
        <h2>Product Overview</h2>
        <p>${escapeHtml(plainDesc)}</p>
      </div>
      ${
        allSpecs.length > 0
          ? `<div>
        <h2>Key Specifications</h2>
        <ul>
          ${allSpecs.map((s) => `<li><strong>${escapeHtml(s.name)}:</strong> ${escapeHtml(s.value)}</li>`).join('')}
        </ul>
      </div>`
          : ''
      }
      ${
        reviews.length > 0
          ? `<div>
        <h2>Customer Reviews (${reviews.length})</h2>
        <ul>
          ${reviews
            .map(
              (r) => `<li>
            <strong>${escapeHtml(r.author_name || 'Verified Buyer')}</strong> — ${r.rating}/5 Stars
            ${r.comment ? `<p>${escapeHtml(stripHtml(r.comment))}</p>` : ''}
          </li>`
            )
            .join('')}
        </ul>
      </div>`
          : ''
      }
    </article>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

async function renderCategory(businessId, slug, origin) {
  const [rows] = await pool.query('SELECT * FROM categories WHERE business_id = ? AND slug = ?', [businessId, slug]);
  if (rows.length === 0) return null;
  const category = rows[0];

  const [subcategories] = await pool.query(
    'SELECT name, slug FROM categories WHERE business_id = ? AND parent_id = ? ORDER BY sort_order, name',
    [businessId, category.id]
  );

  const [products] = await pool.query(
    `SELECT name, slug, price, discount_price, is_on_sale, image, brand 
     FROM products 
     WHERE business_id = ? AND category_id = ? AND is_active = 1 
     ORDER BY is_featured DESC, updated_at DESC LIMIT 30`,
    [businessId, category.id]
  );

  const canonicalUrl = `${origin}/category/${category.slug}`;
  const metaDesc = escapeHtml(
    category.description
      ? stripHtml(category.description).slice(0, 160)
      : `Explore ${category.name} at IT Solutions Pakistan. High quality products, official warranty, delivery nationwide.`
  );
  const pageTitle = escapeHtml(`${category.name} — IT Solutions Pakistan`);

  const jsonLdBreadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
      { '@type': 'ListItem', position: 2, name: category.name, item: canonicalUrl },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDesc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${origin}/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${metaDesc}">
  <meta name="twitter:image" content="${origin}/og-image.jpg">
  <script type="application/ld+json">${JSON.stringify(jsonLdBreadcrumbs)}</script>
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <span>${escapeHtml(category.name)}</span>
    </nav>
  </header>
  <main>
    <h1>${escapeHtml(category.name)}</h1>
    ${category.description ? `<p>${escapeHtml(stripHtml(category.description))}</p>` : ''}

    ${
      subcategories.length > 0
        ? `<section>
      <h2>Subcategories</h2>
      <ul>
        ${subcategories
          .map((sub) => `<li><a href="${origin}/category/${escapeHtml(sub.slug)}">${escapeHtml(sub.name)}</a></li>`)
          .join('')}
      </ul>
    </section>`
        : ''
    }

    <section>
      <h2>Products in ${escapeHtml(category.name)}</h2>
      ${
        products.length > 0
          ? `<ul>
        ${products
          .map((p) => {
            const price = p.is_on_sale && p.discount_price ? p.discount_price : p.price;
            return `<li>
            <a href="${origin}/product/${escapeHtml(p.slug)}">
              <strong>${escapeHtml(p.name)}</strong> — PKR ${Number(price).toLocaleString('en-PK')}
            </a>
          </li>`;
          })
          .join('')}
      </ul>`
          : '<p>No products found in this category.</p>'
      }
    </section>

    <section>
      <h2>Buy ${escapeHtml(category.name)} Online in Pakistan — IT Solutions</h2>
      <p>Welcome to IT Solutions Pakistan's official store for <strong>${escapeHtml(category.name)}</strong>. We bring you 100% genuine products with official brand warranty, competitive market prices, free shipping on your first order, and fast nationwide delivery across Pakistan, including Lahore, Karachi, Islamabad, Rawalpindi, Multan, and Peshawar.</p>
      <p>Whether you are upgrading your home setup or equipping your enterprise office, explore our curated range of ${escapeHtml(category.name.toLowerCase())} designed for durability and high performance. All orders are backed by Cash on Delivery (COD) and dedicated technical support.</p>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

async function renderShop(businessId, origin) {
  const [categories] = await pool.query(
    'SELECT name, slug FROM categories WHERE business_id = ? AND parent_id IS NULL ORDER BY sort_order, name LIMIT 20',
    [businessId]
  );

  const [products] = await pool.query(
    `SELECT name, slug, price, discount_price, is_on_sale 
     FROM products 
     WHERE business_id = ? AND is_active = 1 
     ORDER BY is_featured DESC, updated_at DESC LIMIT 30`,
    [businessId]
  );

  const canonicalUrl = `${origin}/shop`;
  const pageTitle = 'Shop All Products — IT Solutions Pakistan';
  const metaDesc = 'Browse our complete catalog of security cameras, NVRs, networking gear, and IT hardware at IT Solutions Pakistan.';

  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDesc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${origin}/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${metaDesc}">
  <meta name="twitter:image" content="${origin}/og-image.jpg">
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <span>Shop</span>
    </nav>
  </header>
  <main>
    <h1>Shop All Products</h1>
    <section>
      <h2>Categories</h2>
      <ul>
        ${categories
          .map((c) => `<li><a href="${origin}/category/${escapeHtml(c.slug)}">${escapeHtml(c.name)}</a></li>`)
          .join('')}
      </ul>
    </section>
    <section>
      <h2>Featured Products</h2>
      <ul>
        ${products
          .map((p) => {
            const price = p.is_on_sale && p.discount_price ? p.discount_price : p.price;
            return `<li>
            <a href="${origin}/product/${escapeHtml(p.slug)}">
              <strong>${escapeHtml(p.name)}</strong> — PKR ${Number(price).toLocaleString('en-PK')}
            </a>
          </li>`;
          })
          .join('')}
      </ul>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

async function renderHome(businessId, origin) {
  const [categories] = await pool.query(
    'SELECT name, slug FROM categories WHERE business_id = ? AND parent_id IS NULL ORDER BY sort_order, name LIMIT 12',
    [businessId]
  );

  const [products] = await pool.query(
    `SELECT name, slug, price, discount_price, is_on_sale 
     FROM products 
     WHERE business_id = ? AND is_active = 1 AND is_featured = 1 
     ORDER BY updated_at DESC LIMIT 16`,
    [businessId]
  );

  const canonicalUrl = origin;
  const pageTitle = 'IT Solutions Pakistan — Premier Security & IT Hardware Store';
  const metaDesc = 'Leading supplier of Hikvision security cameras, NVRs, DVRs, networking equipment and IT hardware in Pakistan. Best prices & warranty.';

  const jsonLdOrg = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'IT Solutions Trade & Service Pvt. Ltd.',
    url: origin,
    image: `${origin}/favicon.svg`,
    logo: `${origin}/favicon.svg`,
    description: metaDesc,
    telephone: '+92 300 4265499',
    email: 'itsolutions543@gmail.com',
    priceRange: 'PKR',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III',
      addressLocality: 'Lahore',
      addressRegion: 'Punjab',
      postalCode: '54660',
      addressCountry: 'PK',
    },
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '10:00',
        closes: '20:00',
      },
    ],
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 31.5126,
      longitude: 74.3436,
    },
    hasMap: 'https://maps.google.com/?q=Fazal+Trade+Center+Hafeez+Center+Gulberg+Lahore',
    paymentAccepted: 'Cash on Delivery, Bank Transfer, Credit Card',
  };

  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDesc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${origin}/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${metaDesc}">
  <meta name="twitter:image" content="${origin}/og-image.jpg">
  <script type="application/ld+json">${JSON.stringify(jsonLdOrg)}</script>
</head>
<body>
  <header>
    <h1>IT Solutions Pakistan</h1>
    <p>Your Trusted Partner for Security Cameras, Networking & IT Hardware</p>
    <nav>
      <a href="${origin}">Home</a> | 
      <a href="${origin}/shop">Shop All</a> | 
      <a href="${origin}/about-us">About Us</a> | 
      <a href="${origin}/contact">Contact Us</a>
    </nav>
  </header>
  <main>
    <section>
      <h2>Product Categories</h2>
      <ul>
        ${categories
          .map((c) => `<li><a href="${origin}/category/${escapeHtml(c.slug)}">${escapeHtml(c.name)}</a></li>`)
          .join('')}
      </ul>
    </section>
    <section>
      <h2>Featured Products</h2>
      <ul>
        ${products
          .map((p) => {
            const price = p.is_on_sale && p.discount_price ? p.discount_price : p.price;
            return `<li>
            <a href="${origin}/product/${escapeHtml(p.slug)}">
              <strong>${escapeHtml(p.name)}</strong> — PKR ${Number(price).toLocaleString('en-PK')}
            </a>
          </li>`;
          })
          .join('')}
      </ul>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

async function renderCmsPage(businessId, path, origin) {
  const canonicalUrl = `${origin}${path}`;

  if (path === '/contact') {
    const pageTitle = 'Contact Us — Customer Support & Store Location | IT Solutions Pakistan';
    const metaDesc = 'Contact IT Solutions customer support. Get help with laptop sales, CCTV camera quotes, order tracking, and store address in Lahore, Pakistan. Phone/WhatsApp: +92 300 4265499.';
    const jsonLdContact = {
      '@context': 'https://schema.org',
      '@type': 'ContactPage',
      mainEntity: {
        '@type': 'LocalBusiness',
        name: 'IT Solutions Trade & Service Pvt. Ltd.',
        telephone: '+92 300 4265499',
        email: 'itsolutions543@gmail.com',
        priceRange: 'PKR',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III',
          addressLocality: 'Lahore',
          addressRegion: 'Punjab',
          postalCode: '54660',
          addressCountry: 'PK',
        },
        geo: {
          '@type': 'GeoCoordinates',
          latitude: 31.5126,
          longitude: 74.3436,
        },
        openingHoursSpecification: [
          {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            opens: '10:00',
            closes: '20:00',
          },
        ],
        hasMap: 'https://maps.google.com/?q=Fazal+Trade+Center+Hafeez+Center+Gulberg+Lahore',
      },
    };

    return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${origin}/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
  <meta name="twitter:image" content="${origin}/og-image.jpg">
  <script type="application/ld+json">${JSON.stringify(jsonLdContact)}</script>
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <span>Contact Us</span>
    </nav>
  </header>
  <main>
    <h1>Contact IT Solutions Pakistan</h1>
    <section>
      <h2>Physical Store Location & Contact Info</h2>
      <p><strong>Store Address:</strong> Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III, Lahore, Punjab 54660, Pakistan</p>
      <p><strong>Phone / WhatsApp:</strong> <a href="tel:+923004265499">+92 300 4265499</a></p>
      <p><strong>Support Email:</strong> <a href="mailto:itsolutions543@gmail.com">itsolutions543@gmail.com</a></p>
      <p><strong>Working Hours:</strong> Monday – Saturday (10:00 AM – 8:00 PM PKT)</p>
      <p><a href="https://maps.google.com/?q=Fazal+Trade+Center+Hafeez+Center+Gulberg+Lahore" target="_blank">Get Google Maps Directions</a></p>
    </section>
    <section>
      <h2>Nationwide Delivery & Support</h2>
      <p>IT Solutions provides fast Cash on Delivery (COD) and courier shipping to Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan, Peshawar, Quetta, and 200+ cities across Pakistan with free shipping on your first order and a 7-day return guarantee.</p>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
  }

  if (path === '/about-us') {
    const pageTitle = 'About Us — IT Solutions Pakistan | Authorized Tech Store & Hardware Supplier';
    const metaDesc = 'Learn about IT Solutions — Pakistan\'s trusted IT store for laptops, security surveillance systems, networking hardware, and solar solutions.';
    const jsonLdOrg = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'IT Solutions Trade & Service Pvt. Ltd.',
      url: origin,
      logo: `${origin}/favicon.svg`,
      contactPoint: {
        '@type': 'ContactPoint',
        telephone: '+92 300 4265499',
        contactType: 'customer service',
        areaServed: 'PK',
        availableLanguage: ['en', 'ur'],
      },
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III',
        addressLocality: 'Lahore',
        addressRegion: 'Punjab',
        postalCode: '54660',
        addressCountry: 'PK',
      },
    };

    return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${origin}/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
  <meta name="twitter:image" content="${origin}/og-image.jpg">
  <script type="application/ld+json">${JSON.stringify(jsonLdOrg)}</script>
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <span>About Us</span>
    </nav>
  </header>
  <main>
    <h1>About IT Solutions Pakistan</h1>
    <section>
      <p>IT Solutions Trade & Service Pvt. Ltd. is a premier supplier of high-performance laptops, Hikvision security cameras, networking equipment, and solar inverter solutions in Pakistan.</p>
      <p>Located in Gulberg III, Lahore near Hafeez Center, we deliver genuine tech products with official brand warranty, transparent market rates, and nationwide Cash on Delivery (COD) services.</p>
    </section>
    <section>
      <h2>Visit Our Physical Store</h2>
      <p>Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III, Lahore, Punjab 54660, Pakistan.</p>
      <p>Store Hours: Monday to Saturday (10:00 AM – 8:00 PM PKT)</p>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
  }

  if (path === '/return-exchange') {
    const pageTitle = 'Return & Exchange Policy — IT Solutions Pakistan';
    const metaDesc = 'Read the official return, exchange, 7-day replacement, defective item guidelines, and shipping charges policy at IT Solutions Pakistan.';
    
    let sections = [];
    try {
      const [rows] = await pool.query('SELECT value FROM site_content WHERE business_id = ? AND content_key = ?', [businessId, 'policies']);
      if (rows.length > 0) {
        const val = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
        if (Array.isArray(val.sections)) sections = val.sections;
      }
    } catch (err) {
      console.error('Error fetching prerender policy content:', err);
    }

    if (sections.length === 0) {
      sections = [
        { heading: 'Return Window', body: 'Products can be returned within 7 days of delivery, provided they are unused, in their original packaging, and accompanied by the original invoice.' },
        { heading: 'Conditions for Return', body: 'Items must not be physically damaged or missing accessories. Software, opened consumables, and customized/build-to-order products are not eligible for return.' },
        { heading: 'Exchange & Return Process (By Mail)', body: 'To request an exchange or return, contact our support team with your order number. Once approved, ship the parcel via courier (by mail) to our official store address. The replacement or refund is dispatched after the returned item passes inspection.' },
        { heading: 'Defective or Damaged Items', body: 'Defective or damaged items must be reported within 24 hours of delivery along with an unboxing video proof for immediate replacement.' },
        { heading: 'Warranty Claims', body: 'All products carry the manufacturer warranty stated on the product page. Warranty claims are coordinated directly with the relevant brand’s authorized service center.' },
        { heading: 'Refunds', body: 'Approved refunds are processed back to the original payment method within 7–10 business days of the returned item passing inspection.' },
        { heading: 'Return Shipping Charges', body: 'The customer is responsible for paying return shipping/courier charges when sending items back for inspection or exchange.' }
      ];
    }

    const jsonLdReturnPolicy = {
      '@context': 'https://schema.org',
      '@type': 'MerchantReturnPolicy',
      name: 'IT Solutions Return & Exchange Policy',
      applicableCountry: 'PK',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 7,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
      customerRemorseReturnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
      itemCondition: 'https://schema.org/NewCondition',
      refundType: 'https://schema.org/FullRefund'
    };

    return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <script type="application/ld+json">${JSON.stringify(jsonLdReturnPolicy)}</script>
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <span>Return &amp; Exchange Policy</span>
    </nav>
  </header>
  <main>
    <h1>Return &amp; Exchange Policy</h1>
    ${sections.map(s => `
      <section>
        <h2>${escapeHtml(s.heading)}</h2>
        <p>${escapeHtml(s.body)}</p>
      </section>
    `).join('')}
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
  }

  const titles = {
    '/privacy-policy': 'Privacy Policy — IT Solutions Pakistan',
  };

  const h1s = {
    '/privacy-policy': 'Privacy Policy',
  };

  const pageTitle = titles[path] || 'IT Solutions Pakistan';
  const h1Text = h1s[path] || 'Information';

  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <span>${escapeHtml(h1Text)}</span>
    </nav>
  </header>
  <main>
    <h1>${escapeHtml(h1Text)}</h1>
    <p>Welcome to IT Solutions Pakistan. For inquiries or customer service, please visit our website or contact our support team.</p>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

async function renderBlogList(businessId, origin) {
  const canonicalUrl = `${origin}/blog`;
  const pageTitle = 'Tech Blog & Buying Guides — 4K CCTV, Routers, Solar & Laptops | IT Solutions Pakistan';
  const metaDesc = 'Read expert tech buying guides, 4K CCTV camera reviews, Wi-Fi 6 router comparisons, and solar energy solutions for home & office in Pakistan.';

  const [posts] = await pool.query(
    'SELECT title, slug, excerpt, cover_image, category, author, read_time, created_at FROM blog_posts WHERE business_id = ? AND is_published = 1 ORDER BY created_at DESC LIMIT 20',
    [businessId]
  ).catch(() => [[]]);

  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${origin}/og-image.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <span>Tech Blog &amp; Guides</span>
    </nav>
  </header>
  <main>
    <h1>Tech Blog &amp; Buying Guides</h1>
    <p>Expert buyer guides, CCTV surveillance setups, networking tips, and tech advice in Pakistan.</p>
    <section>
      <h2>Latest Tech Articles</h2>
      <ul>
        ${(Array.isArray(posts) ? posts : []).map(p => `
          <li>
            <article>
              <h3><a href="${origin}/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h3>
              <p>${escapeHtml(p.excerpt)}</p>
              <small>Category: ${escapeHtml(p.category)} | ${escapeHtml(p.read_time)}</small>
            </article>
          </li>
        `).join('')}
      </ul>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

async function renderBlogPost(businessId, slug, origin) {
  const [rows] = await pool.query(
    'SELECT * FROM blog_posts WHERE business_id = ? AND slug = ? AND is_published = 1',
    [businessId, slug]
  );

  if (rows.length === 0) {
    return render404(origin, 'Blog post not found');
  }

  const post = rows[0];
  const canonicalUrl = `${origin}/blog/${post.slug}`;
  const pageTitle = `${post.title} | IT Solutions Pakistan`;
  const metaDesc = post.excerpt ? post.excerpt.slice(0, 160) : post.title;
  const coverImg = post.cover_image || `${origin}/og-image.jpg`;

  const jsonLdArticle = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    image: [coverImg],
    author: {
      '@type': 'Organization',
      name: post.author || 'IT Solutions Tech Team',
      url: origin,
    },
    publisher: {
      '@type': 'Organization',
      name: 'IT Solutions Trade & Service Pvt. Ltd.',
      logo: {
        '@type': 'ImageObject',
        url: `${origin}/favicon.svg`,
      },
    },
    datePublished: post.created_at ? new Date(post.created_at).toISOString() : new Date().toISOString(),
    dateModified: post.updated_at ? new Date(post.updated_at).toISOString() : new Date().toISOString(),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
  };

  const jsonLdBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${origin}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: canonicalUrl },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${getGoogleVerificationTag()}
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(coverImg)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
  <meta name="twitter:image" content="${escapeHtml(coverImg)}">
  <script type="application/ld+json">${JSON.stringify(jsonLdArticle)}</script>
  <script type="application/ld+json">${JSON.stringify(jsonLdBreadcrumb)}</script>
</head>
<body>
  <header>
    <nav>
      <a href="${origin}">Home</a> › <a href="${origin}/blog">Blog</a> › <span>${escapeHtml(post.title)}</span>
    </nav>
  </header>
  <main>
    <article>
      <h1>${escapeHtml(post.title)}</h1>
      <p><em>Category: ${escapeHtml(post.category)} | By ${escapeHtml(post.author)} | ${escapeHtml(post.read_time)}</em></p>
      <div>${post.content}</div>
    </article>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} IT Solutions Pakistan. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

function render404(origin, message) {
  return `<!DOCTYPE html>
<html lang="en-PK">
<head>
  <meta charset="UTF-8">
  <title>404 — Page Not Found | IT Solutions</title>
  <meta name="robots" content="noindex, follow">
</head>
<body>
  <h1>404 — ${escapeHtml(message)}</h1>
  <p><a href="${origin}">Return to Homepage</a></p>
</body>
</html>`;
}
