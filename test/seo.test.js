import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';
import { request } from './_support/helpers.js';
import { ADMIN_PATH } from '../config/env.js';

describe('seo', () => {
  after(async () => {
    await pool.end();
  });

  describe('GET /robots.txt', () => {
    it('returns a plain-text robots file disallowing admin/account paths and pointing at the sitemap', async () => {
      const res = await request.get('/robots.txt');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/plain'));
      assert.ok(res.text.includes(`Disallow: ${ADMIN_PATH}`));
      assert.ok(res.text.includes('Disallow: /checkout'));
      assert.ok(res.text.includes('Disallow: /account'));
      assert.ok(res.text.includes('Allow: /'));
      assert.match(res.text, /Sitemap: .+\/sitemap\.xml/);
    });
  });

  describe('GET /sitemap.xml', () => {
    it('returns a well-formed sitemap including static paths, categories, and products', async () => {
      const res = await request.get('/sitemap.xml');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/xml'));
      assert.ok(res.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(res.text.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
      assert.ok(res.text.includes('</urlset>'));
      // Static paths declared in seoController.js should always be present.
      assert.ok(res.text.includes('<loc>') && res.text.includes('/shop</loc>'));
      assert.ok(res.text.includes('/about-us</loc>'));
    });

    it('reflects a newly created product\'s slug', async () => {
      const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
      const slug = `test-seo-sitemap-${Date.now()}`;
      const [result] = await pool.query(
        "INSERT INTO products (business_id, name, slug, price, stock) VALUES (?, 'Test Sitemap Product', ?, 100, 5)",
        [business.id, slug]
      );

      try {
        const res = await request.get('/sitemap.xml');
        assert.equal(res.status, 200);
        assert.ok(res.text.includes(`/product/${slug}</loc>`));
      } finally {
        await pool.query('DELETE FROM products WHERE id = ?', [result.insertId]);
      }
    });

    it('reflects a newly created category\'s slug', async () => {
      const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
      const slug = `test-seo-category-${Date.now()}`;
      const [result] = await pool.query(
        "INSERT INTO categories (business_id, name, slug) VALUES (?, 'Test Sitemap Category', ?)",
        [business.id, slug]
      );

      try {
        const res = await request.get('/sitemap.xml');
        assert.equal(res.status, 200);
        assert.ok(res.text.includes(`/category/${slug}</loc>`));
      } finally {
        await pool.query('DELETE FROM categories WHERE id = ?', [result.insertId]);
      }
    });
  });

  describe('GET /products-feed.xml', () => {
    it('returns a well-formed Google Shopping RSS 2.0 XML feed with PKR pricing', async () => {
      const res = await request.get('/products-feed.xml');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/xml'));
      assert.ok(res.text.includes('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">'));
      assert.ok(res.text.includes('<channel>'));
      assert.ok(res.text.includes('</rss>'));
    });

    it('excludes hidden products (is_active = 0)', async () => {
      const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
      const activeSlug = `test-feed-active-${Date.now()}`;
      const hiddenSlug = `test-feed-hidden-${Date.now()}`;

      const [activeRes] = await pool.query(
        "INSERT INTO products (business_id, name, slug, price, stock, is_active) VALUES (?, 'Active Feed Product', ?, 1500, 10, 1)",
        [business.id, activeSlug]
      );
      const [hiddenRes] = await pool.query(
        "INSERT INTO products (business_id, name, slug, price, stock, is_active) VALUES (?, 'Hidden Feed Product', ?, 1500, 10, 0)",
        [business.id, hiddenSlug]
      );

      try {
        const res = await request.get('/products-feed.xml');
        assert.equal(res.status, 200);
        assert.ok(res.text.includes(`/product/${activeSlug}`));
        assert.ok(!res.text.includes(`/product/${hiddenSlug}`));
        assert.ok(res.text.includes('1500.00 PKR'));
      } finally {
        await pool.query('DELETE FROM products WHERE id IN (?, ?)', [activeRes.insertId, hiddenRes.insertId]);
      }
    });
  });

  describe('GET /prerender', () => {
    it('returns prerendered HTML for home page (/)', async () => {
      const res = await request.get('/prerender?path=/');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.text.includes('<!DOCTYPE html>'));
      assert.ok(res.text.includes('<title>'));
      assert.ok(res.text.includes('IT Solutions Pakistan'));
      assert.ok(res.text.includes('application/ld+json'));
    });

    it('returns prerendered HTML for /shop page', async () => {
      const res = await request.get('/prerender?path=/shop');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.text.includes('Shop All Products'));
    });

    it('returns prerendered HTML for a product page with Product JSON-LD schema', async () => {
      const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
      const slug = `test-prerender-product-${Date.now()}`;
      const [prodRes] = await pool.query(
        "INSERT INTO products (business_id, name, slug, price, stock, brand, description, is_active) VALUES (?, 'Hikvision 4K Camera', ?, 25000, 10, 'Hikvision', 'Ultra HD security camera', 1)",
        [business.id, slug]
      );

      try {
        const res = await request.get(`/prerender?path=/product/${slug}`);
        assert.equal(res.status, 200);
        assert.ok(res.headers['content-type'].includes('text/html'));
        assert.ok(res.text.includes('Hikvision 4K Camera'));
        assert.ok(res.text.includes('25,000'));
        assert.ok(res.text.includes('og:type" content="product"'));
        assert.ok(res.text.includes('"@type":"Product"'));
        assert.ok(res.text.includes('"price":"25000"'));
      } finally {
        await pool.query('DELETE FROM products WHERE id = ?', [prodRes.insertId]);
      }
    });

    it('returns prerendered HTML for a category page', async () => {
      const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
      const slug = `test-prerender-cat-${Date.now()}`;
      const [catRes] = await pool.query(
        "INSERT INTO categories (business_id, name, slug, description) VALUES (?, 'Security Solutions', ?, 'Top cameras and NVRs')",
        [business.id, slug]
      );

      try {
        const res = await request.get(`/prerender?path=/category/${slug}`);
        assert.equal(res.status, 200);
        assert.ok(res.headers['content-type'].includes('text/html'));
        assert.ok(res.text.includes('Security Solutions'));
        assert.ok(res.text.includes('Top cameras and NVRs'));
        assert.ok(res.text.includes('BreadcrumbList'));
      } finally {
        await pool.query('DELETE FROM categories WHERE id = ?', [catRes.insertId]);
      }
    });

    it('returns 404 HTML for non-existent product slug', async () => {
      const res = await request.get('/prerender?path=/product/non-existent-slug-xyz-12345');
      assert.equal(res.status, 404);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.text.includes('404'));
    });

    it('returns 404 HTML for malformed slug (security path traversal attempt)', async () => {
      const res = await request.get('/prerender?path=/product/../../etc/passwd');
      assert.equal(res.status, 404);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.text.includes('404'));
    });
  });
});


