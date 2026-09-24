import pool from '../config/db.js';

let tableChecked = false;
async function ensureBlogTable() {
  if (tableChecked) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_id INT NOT NULL DEFAULT 1,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        excerpt TEXT NOT NULL,
        content LONGTEXT NOT NULL,
        cover_image VARCHAR(500),
        category VARCHAR(100) DEFAULT 'Tech Guides',
        author VARCHAR(100) DEFAULT 'IT Solutions Team',
        read_time VARCHAR(50) DEFAULT '5 min read',
        featured_product_ids JSON,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        views INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY business_id_slug (business_id, slug),
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [existing] = await pool.query('SELECT COUNT(*) as count FROM blog_posts WHERE business_id = 1');
    if (existing[0].count === 0) {
      const posts = [
        {
          title: 'Top 5 Best 4K CCTV Cameras in Pakistan (2026 Buying & Price Guide)',
          slug: 'top-5-best-4k-cctv-cameras-pakistan-buying-guide',
          excerpt: 'Looking for the best 4K CCTV security cameras for your home, office, or shop in Pakistan? Discover top-rated EZVIZ, Hikvision, and IMOU outdoor & indoor cameras with color night vision, 4G SIM support, and AI auto-tracking.',
          category: 'Security & Surveillance',
          author: 'IT Solutions Tech Team',
          read_time: '6 min read',
          cover_image: 'https://images.unsplash.com/photo-1557597774-9d273605dfa9?w=1200&q=80',
          featured_product_ids: JSON.stringify([17, 21, 22, 15, 20]),
          content: `
<h2>Why 4K CCTV Cameras are Essential for Security in Pakistan</h2>
<p>Securing your home, warehouse, or commercial office in Pakistan requires high-resolution video surveillance. Modern <strong>4K (8MP & 5MP) CCTV cameras</strong> provide crystal-clear image clarity, allowing you to easily read license plates, identify faces, and monitor night-time activity with full-color night vision.</p>

<h3>Key Features to Look for Before Buying:</h3>
<ul>
  <li><strong>Resolution:</strong> 3K (5MP) or 4K (8MP) for maximum detail over wide outdoor areas.</li>
  <li><strong>Connectivity:</strong> 4G SIM Card slot for remote locations without Wi-Fi (farms, construction sites, plazas).</li>
  <li><strong>Color Night Vision:</strong> Dual spotlights that activate automatically when human motion is detected.</li>
  <li><strong>Two-Way Audio:</strong> Built-in microphone and speaker for real-time conversation via mobile app.</li>
  <li><strong>Weatherproofing:</strong> IP65 or IP67 certified casing built for harsh Pakistani weather conditions.</li>
</ul>

<h2>1. EZVIZ CS-H8c Pro 3K 5MP Outdoor Camera</h2>
<p>The <strong>EZVIZ H8c Pro 3K</strong> is our #1 recommendation for outdoor surveillance in Lahore, Karachi, and Islamabad. Equipped with 360-degree motor rotation, AI human shape detection, and color night vision, it replaces multiple fixed cameras in a single installation.</p>

<h2>2. EZVIZ CS-H8c 4G 2K (3MP) — Best for Remote Locations</h2>
<p>If your location lacks a home Wi-Fi router, the <strong>EZVIZ H8c 4G</strong> connects directly to Jazz, Zong, Telenor, or Ufone 4G SIM cards. Perfect for farmhouses, parking lots, and remote shops.</p>
          `.trim()
        },
        {
          title: 'Wi-Fi 6 Routers in Pakistan: Complete Home & Office Buying Guide 2026',
          slug: 'wifi-6-routers-pakistan-buying-guide-2026',
          excerpt: 'Upgrade your internet speed with high-performance Wi-Fi 6 Gigabit routers in Pakistan. Compare speed, coverage, dual-band stability, and seamless mesh networking for PTCL, Nayatel, and StormFiber connections.',
          category: 'Networking',
          author: 'IT Solutions Tech Team',
          read_time: '5 min read',
          cover_image: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1200&q=80',
          featured_product_ids: JSON.stringify([19, 5]),
          content: `
<h2>Why Upgrade to Wi-Fi 6 (802.11ax) in Pakistan?</h2>
<p>With fiber-optic internet connections (Nayatel, StormFiber, Transworld, PTCL Flash Fiber) offering 50Mbps to 500Mbps speeds across Pakistan, standard Wi-Fi 5 routers often create bottleneck slowdowns. <strong>Wi-Fi 6 routers</strong> deliver 3x faster wireless speeds, lower latency for online gaming, and handle up to 50 connected devices without lag.</p>

<h3>Benefits of Wi-Fi 6 Routers:</h3>
<ul>
  <li><strong>Gigabit Speeds:</strong> Dual-band combined speeds of up to 3000 Mbps.</li>
  <li><strong>OFDMA & MU-MIMO:</strong> Smooth 4K video streaming and gaming on smartphones, laptops, and smart TVs simultaneously.</li>
</ul>

<h2>Order Original Routers with Official Warranty</h2>
<p>Get original routers with brand warranty and fast Cash on Delivery at <strong>IT Solutions Pakistan</strong>!</p>
          `.trim()
        }
      ];

      for (const p of posts) {
        await pool.query(
          `INSERT INTO blog_posts (business_id, title, slug, excerpt, content, category, author, read_time, cover_image, featured_product_ids, is_published)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [p.title, p.slug, p.excerpt, p.content, p.category, p.author, p.read_time, p.cover_image, p.featured_product_ids]
        );
      }
    }
    tableChecked = true;
  } catch (err) {
    console.error('ensureBlogTable error:', err);
  }
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

async function hydrateProducts(businessId, productIdsJson) {
  if (!productIdsJson) return [];
  let ids = [];
  try {
    ids = typeof productIdsJson === 'string' ? JSON.parse(productIdsJson) : productIdsJson;
    if (!Array.isArray(ids) || ids.length === 0) return [];
  } catch (err) {
    return [];
  }

  const numericIds = ids.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
  if (numericIds.length === 0) return [];

  const placeholders = numericIds.map(() => '?').join(',');
  const [products] = await pool.query(
    `SELECT p.id, p.name, p.slug, p.brand, p.price, p.discount_price, p.is_on_sale, p.stock, p.image, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.business_id = ? AND p.id IN (${placeholders}) AND p.is_active = 1`,
    [businessId, ...numericIds]
  );
  return products;
}

// Public: GET /api/blog
export async function getBlogPosts(req, res) {
  await ensureBlogTable();
  const businessId = req.business?.id || 1;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '12', 10)));
  const offset = (page - 1) * limit;
  const category = req.query.category ? String(req.query.category).trim() : null;
  const search = req.query.search ? String(req.query.search).trim() : null;

  let query = 'SELECT id, title, slug, excerpt, cover_image, category, author, read_time, views, created_at FROM blog_posts WHERE business_id = ? AND is_published = 1';
  const params = [businessId];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search) {
    query += ' AND (title LIKE ? OR excerpt LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

  const [posts] = await pool.query(query, params);

  let countQuery = 'SELECT COUNT(*) as total FROM blog_posts WHERE business_id = ? AND is_published = 1';
  const countParams = [businessId];
  if (category) {
    countQuery += ' AND category = ?';
    countParams.push(category);
  }
  if (search) {
    countQuery += ' AND (title LIKE ? OR excerpt LIKE ?)';
    countParams.push(`%${search}%`, `%${search}%`);
  }
  const [totalRows] = await pool.query(countQuery, countParams);
  const total = totalRows[0]?.total || 0;

  const [categoriesRows] = await pool.query(
    'SELECT DISTINCT category FROM blog_posts WHERE business_id = ? AND is_published = 1 AND category IS NOT NULL',
    [businessId]
  );
  const categories = categoriesRows.map(r => r.category).filter(Boolean);

  res.json({
    posts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    categories,
  });
}

// Public: GET /api/blog/:slug
export async function getBlogPostBySlug(req, res) {
  await ensureBlogTable();
  const businessId = req.business?.id || 1;
  const slug = String(req.params.slug || '').trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const [posts] = await pool.query(
    'SELECT * FROM blog_posts WHERE business_id = ? AND slug = ? AND is_published = 1',
    [businessId, slug]
  );

  if (posts.length === 0) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const post = posts[0];

  pool.query('UPDATE blog_posts SET views = views + 1 WHERE id = ?', [post.id]).catch(() => {});

  const featuredProducts = await hydrateProducts(businessId, post.featured_product_ids);

  const [relatedPosts] = await pool.query(
    'SELECT id, title, slug, excerpt, cover_image, category, read_time, created_at FROM blog_posts WHERE business_id = ? AND is_published = 1 AND id != ? ORDER BY created_at DESC LIMIT 3',
    [businessId, post.id]
  );

  res.json({
    post,
    featuredProducts,
    relatedPosts,
  });
}

// Admin: GET /api/admin/blog
export async function getAdminBlogPosts(req, res) {
  await ensureBlogTable();
  const businessId = req.business?.id || 1;
  const [posts] = await pool.query(
    'SELECT id, title, slug, category, author, read_time, is_published, views, created_at FROM blog_posts WHERE business_id = ? ORDER BY created_at DESC',
    [businessId]
  );
  res.json({ posts });
}

// Admin: POST /api/admin/blog
export async function createAdminBlogPost(req, res) {
  await ensureBlogTable();
  const businessId = req.business?.id || 1;
  const { title, excerpt, content, cover_image, category, author, read_time, featured_product_ids, is_published } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  let slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) slug = `post-${Date.now()}`;

  const [existing] = await pool.query('SELECT id FROM blog_posts WHERE business_id = ? AND slug = ?', [businessId, slug]);
  if (existing.length > 0) {
    slug = `${slug}-${Date.now().toString().slice(-4)}`;
  }

  const cleanExcerpt = (excerpt || stripHtml(content)).slice(0, 350);
  const cleanCategory = (category || 'Tech Guides').trim();
  const cleanAuthor = (author || 'IT Solutions Team').trim();
  const cleanReadTime = (read_time || '5 min read').trim();
  const cleanImage = (cover_image || '').trim();
  const publishedState = is_published === false || is_published === 0 ? 0 : 1;
  const productIdsJson = Array.isArray(featured_product_ids) ? JSON.stringify(featured_product_ids) : null;

  const [result] = await pool.query(
    `INSERT INTO blog_posts (business_id, title, slug, excerpt, content, cover_image, category, author, read_time, featured_product_ids, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [businessId, title.trim(), slug, cleanExcerpt, content, cleanImage, cleanCategory, cleanAuthor, cleanReadTime, productIdsJson, publishedState]
  );

  res.json({ message: 'Blog post created successfully', id: result.insertId, slug });
}

// Admin: PUT /api/admin/blog/:id
export async function updateAdminBlogPost(req, res) {
  await ensureBlogTable();
  const businessId = req.business?.id || 1;
  const postId = parseInt(req.params.id, 10);

  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Invalid post ID' });
  }

  const { title, excerpt, content, cover_image, category, author, read_time, featured_product_ids, is_published } = req.body;

  const [existing] = await pool.query('SELECT id, slug FROM blog_posts WHERE business_id = ? AND id = ?', [businessId, postId]);
  if (existing.length === 0) {
    return res.status(404).json({ error: 'Blog post not found' });
  }

  let slug = existing[0].slug;
  if (title && title.trim()) {
    const newSlug = title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (newSlug && newSlug !== slug) {
      const [duplicate] = await pool.query('SELECT id FROM blog_posts WHERE business_id = ? AND slug = ? AND id != ?', [businessId, newSlug, postId]);
      if (duplicate.length === 0) {
        slug = newSlug;
      }
    }
  }

  const cleanExcerpt = excerpt ? excerpt.slice(0, 350) : undefined;
  const productIdsJson = Array.isArray(featured_product_ids) ? JSON.stringify(featured_product_ids) : undefined;

  await pool.query(
    `UPDATE blog_posts SET
      title = COALESCE(?, title),
      slug = ?,
      excerpt = COALESCE(?, excerpt),
      content = COALESCE(?, content),
      cover_image = COALESCE(?, cover_image),
      category = COALESCE(?, category),
      author = COALESCE(?, author),
      read_time = COALESCE(?, read_time),
      featured_product_ids = COALESCE(?, featured_product_ids),
      is_published = COALESCE(?, is_published)
     WHERE business_id = ? AND id = ?`,
    [title, slug, cleanExcerpt, content, cover_image, category, author, read_time, productIdsJson, is_published, businessId, postId]
  );

  res.json({ message: 'Blog post updated successfully' });
}

// Admin: DELETE /api/admin/blog/:id
export async function deleteAdminBlogPost(req, res) {
  await ensureBlogTable();
  const businessId = req.business?.id || 1;
  const postId = parseInt(req.params.id, 10);

  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Invalid post ID' });
  }

  await pool.query('DELETE FROM blog_posts WHERE business_id = ? AND id = ?', [businessId, postId]);
  res.json({ message: 'Blog post deleted successfully' });
}

function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>?/gm, '').trim();
}
