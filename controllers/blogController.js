import pool from '../config/db.js';
import { buildStoreUrl } from '../utils/storeUrl.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// Helper to hydrate featured product details for blog posts
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

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

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

  // Also get list of distinct categories for filter pills
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

  // Increment view count asynchronously
  pool.query('UPDATE blog_posts SET views = views + 1 WHERE id = ?', [post.id]).catch(() => {});

  // Hydrate featured products if present
  const featuredProducts = await hydrateProducts(businessId, post.featured_product_ids);

  // Get 3 recent related posts in same category or overall
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
  const businessId = req.business?.id || 1;
  const [posts] = await pool.query(
    'SELECT id, title, slug, category, author, read_time, is_published, views, created_at FROM blog_posts WHERE business_id = ? ORDER BY created_at DESC',
    [businessId]
  );
  res.json({ posts });
}

// Admin: POST /api/admin/blog
export async function createAdminBlogPost(req, res) {
  const businessId = req.business?.id || 1;
  const { title, excerpt, content, cover_image, category, author, read_time, featured_product_ids, is_published } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  // Generate clean slug from title
  let slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) slug = `post-${Date.now()}`;

  // Ensure unique slug
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
