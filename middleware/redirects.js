const REDIRECT_MAP = new Map([
  ['/laptops', '/category/laptops'],
  ['/products', '/shop'],
  ['/product-category/laptops', '/category/laptops'],
  ['/categories/laptops', '/category/laptops'],
  ['/categories', '/shop'],
]);

export function handleServerRedirects(req, res, next) {
  // Only process GET and HEAD requests for redirects
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  // Normalize path by lowercasing and stripping trailing slashes
  const rawPath = req.path || '/';
  const pathname = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1).toLowerCase() : rawPath.toLowerCase();

  let targetPath = REDIRECT_MAP.get(pathname);

  // Dynamic mapping: /product-category/:slug -> /category/:slug
  if (!targetPath && pathname.startsWith('/product-category/')) {
    const slug = pathname.replace('/product-category/', '').trim();
    if (slug && !slug.includes('/') && !slug.includes('\\')) {
      targetPath = `/category/${slug}`;
    }
  }

  // Dynamic mapping: /item/:slug -> /product/:slug
  if (!targetPath && pathname.startsWith('/item/')) {
    const slug = pathname.replace('/item/', '').trim();
    if (slug && !slug.includes('/') && !slug.includes('\\')) {
      targetPath = `/product/${slug}`;
    }
  }

  if (targetPath) {
    // Preserve query parameters if present (e.g. /products?sort=price -> /shop?sort=price)
    const queryIndex = req.url.indexOf('?');
    const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
    const fullTarget = `${targetPath}${queryString}`;

    // Security Guard: Prevent Open Redirect vulnerabilities
    if (!fullTarget.startsWith('/') || fullTarget.startsWith('//') || fullTarget.includes('\\') || fullTarget.includes('\0')) {
      return next();
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.redirect(301, fullTarget);
  }

  next();
}
