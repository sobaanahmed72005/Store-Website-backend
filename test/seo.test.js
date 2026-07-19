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
});
