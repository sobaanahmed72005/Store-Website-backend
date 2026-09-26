import pool from '../config/db.js';
import { logger } from './logger.js';

/**
 * Builds a grounded, structured Markdown context string containing all public
 * storefront data (products, specs, variants, PDF datasheets, categories, site policies, and contact info).
 *
 * @param {number} businessId - Business ID for tenant scoping
 * @returns {Promise<{ contextText: string, productCount: number }>} Grounded catalog context
 */
export async function buildChatContext(businessId) {
  try {
    // 1. Fetch Business Info
    const [bizRows] = await pool.query(
      'SELECT name, slug FROM businesses WHERE id = ?',
      [businessId]
    );
    const storeName = bizRows[0]?.name || 'Our Store';

    // 2. Fetch Public Site Content (Policies & Contact Info)
    const [contentRows] = await pool.query(
      'SELECT content_key, value FROM site_content WHERE business_id = ?',
      [businessId]
    );

    const siteContentMap = {};
    for (const row of contentRows) {
      try {
        siteContentMap[row.content_key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      } catch {
        siteContentMap[row.content_key] = row.value;
      }
    }

    // 3. Fetch Active Categories
    const [categories] = await pool.query(
      'SELECT id, name, slug, description FROM categories WHERE business_id = ? ORDER BY sort_order ASC, name ASC',
      [businessId]
    );

    // 4. Fetch Active Products (using SELECT * to be resilient against missing optional DB columns like dataset_text on production)
    const [products] = await pool.query(
      `SELECT *
       FROM products
       WHERE business_id = ? AND is_active = 1
       ORDER BY is_featured DESC, created_at DESC`,
      [businessId]
    );

    const productIds = products.map((p) => p.id);

    // 5. Fetch Product Specs
    let specsByProductId = new Map();
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(',');
      const [specs] = await pool.query(
        `SELECT product_id, label, value FROM product_specs WHERE product_id IN (${placeholders}) AND variant_id IS NULL ORDER BY sort_order, id`,
        productIds
      );
      for (const s of specs) {
        if (!specsByProductId.has(s.product_id)) {
          specsByProductId.set(s.product_id, []);
        }
        specsByProductId.get(s.product_id).push(s);
      }
    }

    // 6. Fetch Product Variants & Options
    let variantsByProductId = new Map();
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(',');
      const [variants] = await pool.query(
        `SELECT id, product_id, price, discount_price, stock, description FROM product_variants WHERE product_id IN (${placeholders}) ORDER BY id ASC`,
        productIds
      );

      if (variants.length > 0) {
        const variantPlaceholders = variants.map(() => '?').join(',');
        const [options] = await pool.query(
          `SELECT pvo.variant_id, o.value, a.name AS attribute
           FROM product_variant_options pvo
           JOIN category_attribute_options o ON o.id = pvo.option_id
           JOIN category_attributes a ON a.id = o.attribute_id
           WHERE pvo.variant_id IN (${variantPlaceholders})`,
          variants.map((v) => v.id)
        );

        for (const v of variants) {
          const vOptions = options
            .filter((o) => o.variant_id === v.id)
            .map((o) => `${o.attribute}: ${o.value}`)
            .join(', ');
          
          const label = vOptions || v.description || `Variant #${v.id}`;
          const vData = { ...v, label };

          if (!variantsByProductId.has(v.product_id)) {
            variantsByProductId.set(v.product_id, []);
          }
          variantsByProductId.get(v.product_id).push(vData);
        }
      }
    }

    // --- CONSTRUCT MARKDOWN CONTEXT ---
    const lines = [];

    lines.push(`=== ${storeName.toUpperCase()} OFFICIAL STORE CATALOG & POLICIES ===\n`);

    // Store Policies & Contact Section
    lines.push(`## 📌 STORE INFORMATION & POLICIES`);
    lines.push(`- Store Name: ${storeName}`);
    if (siteContentMap.contact_info) {
      const c = siteContentMap.contact_info;
      if (c.phone) lines.push(`- Phone / WhatsApp: ${c.phone}`);
      if (c.email) lines.push(`- Email: ${c.email}`);
      if (c.address) lines.push(`- Store Address: ${c.address}`);
      if (c.business_hours) lines.push(`- Business Hours: ${c.business_hours}`);
    } else {
      lines.push(`- Phone: +92 300 4265499`);
      lines.push(`- Email: itsolutions543@gmail.com`);
      lines.push(`- Address: Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III, Lahore, Pakistan`);
      lines.push(`- Business Hours: Monday - Saturday: 10:00 AM - 8:00 PM PKT`);
    }

    lines.push(`- Shipping Policy: Rs. 180 Nationwide Delivery (Free on 1st order). Cash on Delivery (COD) available.`);
    lines.push(`- Return & Exchange Policy: 7-day return/exchange window for defective or incorrect items.`);
    lines.push(`- Payment Methods: Cash on Delivery (COD), Direct Bank Transfer, JazzCash, EasyPaisa.\n`);

    // Categories Section
    if (categories.length > 0) {
      lines.push(`## 📁 PRODUCT CATEGORIES`);
      for (const cat of categories) {
        lines.push(`- **${cat.name}** (slug: \`/category/${cat.slug}\`): ${cat.description || 'Browse products in this category'}`);
      }
      lines.push('');
    }

    // Products Catalog Section
    lines.push(`## 🛒 PRODUCT CATALOG (${products.length} Products Available)`);

    for (const p of products) {
      const priceFormatted = `Rs. ${Number(p.price).toLocaleString('en-PK')}`;
      const saleFormatted = p.is_on_sale && p.discount_price ? `Rs. ${Number(p.discount_price).toLocaleString('en-PK')}` : null;
      const stockStatus = Number(p.stock) > 0 ? `In Stock (${p.stock} units)` : 'Out of Stock';

      lines.push(`---`);
      lines.push(`### Product: ${p.name}`);
      lines.push(`- Brand: ${p.brand || 'Generic'}`);
      lines.push(`- Price: ${saleFormatted ? `${saleFormatted} (Regular Price: ${priceFormatted})` : priceFormatted}`);
      lines.push(`- Availability: ${stockStatus}`);
      lines.push(`- Product Link: \`/product/${p.slug}\``);

      if (p.description) {
        const cleanDesc = p.description.replace(/<[^>]*>?/gm, '').trim().slice(0, 300);
        lines.push(`- Summary: ${cleanDesc}`);
      }

      // Key Specs
      const pSpecs = specsByProductId.get(p.id) || [];
      if (pSpecs.length > 0) {
        lines.push(`- Specifications:`);
        for (const spec of pSpecs) {
          lines.push(`  * ${spec.label}: ${spec.value}`);
        }
      }

      // Variants
      const pVariants = variantsByProductId.get(p.id) || [];
      if (pVariants.length > 0) {
        lines.push(`- Available Variants:`);
        for (const v of pVariants) {
          const vPrice = v.discount_price ? `Rs. ${Number(v.discount_price).toLocaleString('en-PK')}` : `Rs. ${Number(v.price).toLocaleString('en-PK')}`;
          const vStock = Number(v.stock) > 0 ? 'In Stock' : 'Out of Stock';
          lines.push(`  * ${v.label} - Price: ${vPrice} (${vStock})`);
        }
      }

      // PDF Datasheet / Manual Extracted Text
      if (p.dataset_text && p.dataset_text.trim()) {
        lines.push(`- PDF Datasheet / Manual Contents:`);
        lines.push(`  \`\`\`text`);
        lines.push(`  ${p.dataset_text.trim().slice(0, 3000)}`);
        lines.push(`  \`\`\``);
      } else if (p.dataset) {
        lines.push(`- Datasheet: Available for download on the product page.`);
      }
    }

    lines.push(`\n=== END CATALOG ===\n`);

    const contextText = lines.join('\n');
    return { contextText, productCount: products.length };
  } catch (err) {
    logger.error({ err }, 'Failed to build chat context');
    throw err;
  }
}
