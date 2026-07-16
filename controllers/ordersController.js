import fs from 'fs/promises';
import path from 'path';
import pool from '../config/db.js';
import { isDbError } from '../utils/dbErrors.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailGreeting, emailButton, emailParagraph, emailOrderTable, emailStatusBadge, emailDivider, emailInvoiceBlock, escapeHtml } from '../utils/emailTemplate.js';
import { resolveDiscount } from './discountCodesController.js';
import { getCourierSettings, buildTrackingUrl, bookLeopardsPacket, isLeopardsProvider } from './courierController.js';
import { generateInvoicePdf } from '../utils/invoiceGenerator.js';
import { getEmailTemplate, applyPlaceholders } from '../utils/emailLoader.js';
import { getSiteName } from './contentController.js';
import { logAudit } from '../utils/auditLog.js';
import { handlePaymentProofUpload } from '../utils/uploadHandler.js';
import { paymentProofsDir, GENERATED_FILENAME_PATTERN } from '../middleware/upload.js';
import { isObjectStorageConfigured, objectExists, getObjectBuffer } from '../utils/objectStorage.js';
import { FRONTEND_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination.js';

export const uploadPaymentProof = handlePaymentProofUpload;

const CONTENT_TYPE_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

const PAYMENT_PROOF_URL_PATTERN = new RegExp(`^/orders/payment-proof/(${GENERATED_FILENAME_PATTERN.source.slice(1, -1)})$`);

function effectivePrice(product) {
  return product.is_on_sale && product.discount_price != null ? Number(product.discount_price) : Number(product.price);
}

function variantEffectivePrice(variant) {
  return variant.discount_price != null && Number(variant.discount_price) < Number(variant.price)
    ? Number(variant.discount_price)
    : Number(variant.price);
}

// Labels a variant the same way the product detail page's picker would build one, e.g.
// "256 GB" or "256 GB / Black" for multi-dimension variants — used to snapshot a human-readable
// order_items.variant_label at the time of purchase (the admin/customer order views read this
// column directly rather than re-deriving it from product_variant_options after the fact).
async function labelVariants(variantIds) {
  if (!variantIds.length) return new Map();
  const [options] = await pool.query(
    `SELECT pvo.variant_id, o.value
     FROM product_variant_options pvo
     JOIN category_attribute_options o ON o.id = pvo.option_id
     WHERE pvo.variant_id IN (${variantIds.map(() => '?').join(',')})
     ORDER BY pvo.variant_id, o.id`,
    variantIds
  );
  const labels = new Map();
  for (const { variant_id, value } of options) {
    labels.set(variant_id, [...(labels.get(variant_id) || []), value]);
  }
  return new Map([...labels].map(([id, values]) => [id, values.join(' / ')]));
}

export async function createOrder(req, res) {
  const { shipping_name, shipping_address, shipping_city, phone, email, notes, items, discount_code, payment_method, payment_reference, payment_proof_image } = req.body;
  const user_id = req.user.id;
  if (!shipping_address || !phone || !items?.length) {
    return res.status(400).json({ error: 'shipping_address, phone and items are required' });
  }

  const [paymentRows] = await pool.query(
    'SELECT value FROM site_content WHERE business_id = ? AND content_key = ?',
    [req.business.id, 'payment-settings']
  );
  const paymentMethods = paymentRows.length > 0
    ? (typeof paymentRows[0].value === 'string' ? JSON.parse(paymentRows[0].value) : paymentRows[0].value).methods
    : {};
  if (!payment_method || !paymentMethods?.[payment_method]?.enabled) {
    return res.status(400).json({ error: 'Please select a valid payment method' });
  }
  // Cash on Delivery is settled at the door, so there's nothing to verify up front — every
  // other method is an unverifiable manual transfer, so a reference AND proof screenshot are
  // both mandatory: the reference alone is just a typed-in claim, easy to fabricate or reuse.
  if (payment_method !== 'cod' && (!payment_reference?.trim() || !payment_proof_image)) {
    return res.status(400).json({ error: 'A transaction reference and payment screenshot are required for this payment method' });
  }
  if (payment_method !== 'cod') {
    // payment_proof_image must be a filename this app's own upload endpoint actually wrote to
    // disk, not an arbitrary client-supplied string or external URL — otherwise anyone could
    // "prove" payment with nothing behind it, or point an admin's browser at a URL of their choosing.
    const match = PAYMENT_PROOF_URL_PATTERN.exec(payment_proof_image);
    const exists = match && (isObjectStorageConfigured
      ? await objectExists(`payment-proofs/${match[1]}`)
      : await fs.access(path.join(paymentProofsDir, match[1])).then(() => true, () => false));
    if (!exists) return res.status(400).json({ error: 'Invalid payment screenshot' });
  }

  const MAX_QTY_PER_LINE = 999;
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      return res.status(400).json({ error: `Invalid quantity for item ${item.id}` });
    }
  }

  const productIds = items.map((item) => item.id);
  const [productRows] = await pool.query(
    `SELECT id, name, image, price, discount_price, is_on_sale, stock FROM products WHERE business_id = ? AND id IN (${productIds.map(() => '?').join(',')})`,
    [req.business.id, ...productIds]
  );
  const productById = new Map(productRows.map((p) => [String(p.id), p]));
  if (productById.size !== new Set(productIds.map(String)).size) {
    return res.status(400).json({ error: 'One or more items in your cart are no longer available' });
  }

  // Never trust a client-submitted variant price/stock — independently fetch every referenced
  // variant and confirm it actually belongs to the same business AND the same product id the
  // client claims (an attacker could otherwise pair a cheap product's id with a pricier variant's
  // stock, or vice versa).
  const variantIds = [...new Set(items.filter((i) => i.variantId != null).map((i) => Number(i.variantId)))];
  const variantById = new Map();
  if (variantIds.length > 0) {
    const [variantRows] = await pool.query(
      `SELECT id, product_id, price, discount_price, stock FROM product_variants WHERE business_id = ? AND id IN (${variantIds.map(() => '?').join(',')})`,
      [req.business.id, ...variantIds]
    );
    for (const v of variantRows) variantById.set(v.id, v);
  }
  for (const item of items) {
    if (item.variantId == null) continue;
    const variant = variantById.get(Number(item.variantId));
    if (!variant || variant.product_id !== Number(item.id)) {
      return res.status(400).json({ error: 'One or more items in your cart are no longer available' });
    }
  }
  const variantLabels = await labelVariants(variantIds);

  // Requested quantity is tallied per distinct purchasable thing — a variant line and its parent
  // product's plain stock are independent, so they're keyed separately even when they share a
  // product id.
  const requestedQtyByLine = new Map();
  for (const item of items) {
    const key = item.variantId != null ? `v:${item.variantId}` : `p:${item.id}`;
    requestedQtyByLine.set(key, (requestedQtyByLine.get(key) ?? 0) + Math.trunc(Number(item.quantity)));
  }
  for (const [lineKey, requestedQty] of requestedQtyByLine) {
    if (lineKey.startsWith('v:')) {
      const variant = variantById.get(Number(lineKey.slice(2)));
      const product = productById.get(String(variant.product_id));
      if (requestedQty > variant.stock) {
        return res.status(400).json({ error: `Only ${variant.stock} of "${product?.name || 'this item'}" left in stock` });
      }
    } else {
      const product = productById.get(lineKey.slice(2));
      if (requestedQty > product.stock) {
        return res.status(400).json({ error: `Only ${product.stock} of "${product.name}" left in stock` });
      }
    }
  }

  const orderItems = items.map((item) => {
    const product = productById.get(String(item.id));
    const quantity = Math.trunc(Number(item.quantity));
    const variant = item.variantId != null ? variantById.get(Number(item.variantId)) : null;
    const price = variant ? variantEffectivePrice(variant) : effectivePrice(product);
    const comparePrice = variant ? Number(variant.price) : Number(product.price);
    return {
      product, variant, quantity, price,
      isSalePrice: price < comparePrice,
      variantLabel: variant ? variantLabels.get(variant.id) || null : null,
    };
  });
  const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const [shippingRows] = await pool.query(
    'SELECT value FROM site_content WHERE business_id = ? AND content_key = ?',
    [req.business.id, 'shipping-settings']
  );
  const shippingFee = shippingRows.length > 0
    ? Number((typeof shippingRows[0].value === 'string' ? JSON.parse(shippingRows[0].value) : shippingRows[0].value).fee ?? 1800)
    : 1800;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Atomic "decrement if enough stock" — the UPDATE's WHERE clause is evaluated as part of
    // the same locked read-modify-write, so this can't oversell even under concurrent orders
    // for the same product (unlike the earlier plain SELECT check above, which only exists to
    // fail fast with a friendly message before opening a transaction).
    for (const [lineKey, requestedQty] of requestedQtyByLine) {
      if (lineKey.startsWith('v:')) {
        const variantId = Number(lineKey.slice(2));
        const variant = variantById.get(variantId);
        const [variantStockResult] = await connection.query(
          'UPDATE product_variants SET stock = stock - ? WHERE id = ? AND business_id = ? AND stock >= ?',
          [requestedQty, variantId, req.business.id, requestedQty]
        );
        if (variantStockResult.affectedRows === 0) {
          await connection.rollback();
          const product = productById.get(String(variant.product_id));
          return res.status(400).json({ error: `Only a limited quantity of "${product?.name || 'this item'}" is available. Please update your cart.` });
        }
        // products.stock is the SUM of variant stocks (derived on save) — keep it in sync
        // incrementally rather than leaving it stale until the product is next edited. Always
        // safe: the base product's stock is >= any single variant's, which the check above just confirmed.
        await connection.query(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND business_id = ?',
          [requestedQty, variant.product_id, req.business.id]
        );
      } else {
        const productId = lineKey.slice(2);
        const [stockResult] = await connection.query(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND business_id = ? AND stock >= ?',
          [requestedQty, productId, req.business.id, requestedQty]
        );
        if (stockResult.affectedRows === 0) {
          await connection.rollback();
          const product = productById.get(productId);
          return res.status(400).json({ error: `Only a limited quantity of "${product?.name || 'this item'}" is available. Please update your cart.` });
        }
      }
    }

    let discountAmount = 0;
    let resolvedDiscount = null;
    if (discount_code) {
      try {
        const result = await resolveDiscount({
          businessId: req.business.id,
          userId: user_id,
          code: discount_code,
          subtotal,
          queryRunner: connection,
        });
        discountAmount = result.discountAmount;
        resolvedDiscount = result.discount;
      } catch (err) {
        await connection.rollback();
        // Same reasoning as validateCode in discountCodesController.js: resolveDiscount only
        // sets err.status on its own hand-written validation failures.
        if (!err.status) throw err;
        return res.status(err.status).json({ error: err.message });
      }
    }

    const totalAmount = subtotal + shippingFee - discountAmount;
    const orderStatus = 'pending';
    const [orderResult] = await connection.query(
      `INSERT INTO orders (business_id, user_id, total_amount, shipping_fee, discount_code, discount_amount, shipping_name, shipping_address, shipping_city, phone, email, notes, payment_method, payment_reference, payment_proof_image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.business.id, user_id, totalAmount, shippingFee, resolvedDiscount?.code ?? null, discountAmount,
        shipping_name ?? null, shipping_address, shipping_city ?? null, phone, email ?? null, notes ?? null,
        payment_method, payment_reference ?? null, payment_proof_image ?? null, orderStatus,
      ]
    );
    const orderId = orderResult.insertId;

    for (const item of orderItems) {
      await connection.query(
        'INSERT INTO order_items (order_id, product_ref, variant_id, product_name, variant_label, product_image, quantity, price, is_sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          orderId, String(item.product.id), item.variant?.id ?? null, item.product.name, item.variantLabel,
          item.product.image ?? null, item.quantity, item.price, item.isSalePrice ? 1 : 0,
        ]
      );
    }

    if (resolvedDiscount) {
      const singleUseGuard = resolvedDiscount.reusable ? null : resolvedDiscount.id;
      try {
        await connection.query(
          'INSERT INTO discount_code_redemptions (discount_code_id, user_id, order_id, single_use_guard) VALUES (?, ?, ?, ?)',
          [resolvedDiscount.id, user_id, orderId, singleUseGuard]
        );
      } catch (err) {
        // The single_use_guard_user unique index is the DB-level backstop for the FOR UPDATE
        // lock in resolveDiscount() (see sql/migrate-discount-guard.js) — normally that lock
        // already catches a repeat redemption with the friendly message below, but if it's ever
        // bypassed, this still needs to fail as a clean 400 and not lose the whole order to a
        // raw 500 (the transaction-wide rollback below would otherwise take the valid order,
        // items, and stock decrement down with it).
        if (err.code === 'ER_DUP_ENTRY') {
          await connection.rollback();
          return res.status(400).json({ error: 'You have already used this discount code' });
        }
        throw err;
      }
    }

    await connection.commit();
    res.status(201).json({ id: orderId, total_amount: totalAmount });

    // Persist shipping details on the user record so checkout pre-fills next time
    pool.query(
      'UPDATE users SET saved_phone = ?, saved_address = ?, saved_city = ? WHERE id = ?',
      [phone || null, shipping_address || null, shipping_city || null, user_id]
    ).catch(() => {});

    if (email) {
      const [orderTpl, storeName] = await Promise.all([
        getEmailTemplate(req.business.id, 'order_received').catch(() => null),
        getSiteName(req.business.id),
      ]);
      const orderVars = { name: shipping_name || 'there', order_id: orderId };
      const orderSubject = orderTpl?.subject ? applyPlaceholders(orderTpl.subject, orderVars) : `Order #${orderId} received — thank you!`;
      const orderMessage = orderTpl?.message ? applyPlaceholders(orderTpl.message, orderVars) : `Thanks for your order! We've received it and our team is reviewing it now.`;
      const body =
        emailGreeting(shipping_name) +
        emailParagraph(orderMessage) +
        emailOrderTable([
          { label: 'Order Number', value: `#${orderId}`, bold: true },
          { label: 'Items', value: orderItems.length },
          { label: 'Total', value: `Rs. ${Number(totalAmount).toLocaleString()}` },
          { label: 'Payment', value: payment_method === 'cod' ? 'Cash on Delivery' : 'Bank / Wallet Transfer' },
          { label: 'Shipping to', value: `${shipping_city || ''}${shipping_city ? ', ' : ''}${shipping_address}` },
        ]) +
        emailParagraph("You'll receive another email as soon as your order is confirmed. If you have any questions, simply reply to this email.") +
        emailDivider() +
        emailParagraph("<span style='color:#888;font-size:13px;'>Please keep this email for your records.</span>");
      sendMail({
        to: email,
        subject: orderSubject,
        html: wrapEmail(body, { storeName, preheader: `Your order #${orderId} has been received.` }),
      });
    }
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Payment-proof screenshots can contain bank details/PII, so unlike product images they're not
// served through the public /uploads static mount — this is the only way to fetch one, and it's
// gated to the order's own customer or an admin rather than being world-readable by filename.


// Payment-proof screenshots can contain bank details/PII, so unlike product images they're not
// served through the public /uploads static mount — this is the only way to fetch one, and it's
// gated to the order's own customer or an admin rather than being world-readable by filename.
export async function servePaymentProof(req, res) {
  if (!GENERATED_FILENAME_PATTERN.test(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const url = `/orders/payment-proof/${req.params.filename}`;
  const [rows] = await pool.query(
    'SELECT user_id FROM orders WHERE business_id = ? AND payment_proof_image = ?',
    [req.business.id, url]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && rows[0].user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isObjectStorageConfigured) {
    try {
      const buffer = await getObjectBuffer(`payment-proofs/${req.params.filename}`);
      const ext = req.params.filename.split('.').pop().toLowerCase();
      res.setHeader('Content-Type', CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream');
      return res.end(buffer);
    } catch {
      return res.status(404).json({ error: 'Not found' });
    }
  }

  res.sendFile(path.join(paymentProofsDir, req.params.filename), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Not found' });
  });
}

export async function getOrdersByUser(req, res) {
  const { userId } = req.params;
  const { page, limit, offset } = parsePagination(req, 20);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM orders WHERE business_id = ? AND user_id = ?', [req.business.id, userId]);
  const [orders] = await pool.query(
    'SELECT * FROM orders WHERE business_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [req.business.id, userId, limit, offset]
  );
  const courierSettings = await getCourierSettings(req.business.id);

  // One query for every order's items instead of one query per order — a customer with a long
  // order history used to turn this single request into N+1 sequential round trips, each holding
  // a connection out of the pool.
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id);
    const [items] = await pool.query(
      `SELECT * FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')})`,
      orderIds
    );
    const itemsByOrderId = new Map();
    for (const item of items) {
      if (!itemsByOrderId.has(item.order_id)) itemsByOrderId.set(item.order_id, []);
      itemsByOrderId.get(item.order_id).push(item);
    }
    for (const order of orders) {
      order.items = itemsByOrderId.get(order.id) || [];
      order.tracking_url = buildTrackingUrl(order.tracking_number, courierSettings.tracking_url_template);
    }
  }

  res.json(buildPaginatedResponse('orders', orders, total, page, limit));
}

// A payment_reference reused across more than one order is a red flag for manual transfer
// methods — customers have no way to prove a reference is theirs alone, so a screenshot could
// be paired with a reference that was already claimed by an earlier (possibly unrelated) order.
const DUPLICATE_REFERENCE_SUBQUERY = `
  (SELECT COUNT(*) FROM orders o2
   WHERE o2.business_id = o.business_id AND o2.payment_reference = o.payment_reference)
`;

// Same red flag, for the screenshot itself — createOrder only verifies a payment_proof_image
// points to a file that genuinely exists (see PAYMENT_PROOF_URL_PATTERN below), not that the
// order's own customer was the one who uploaded it, so someone could resubmit another order's
// real screenshot as their own "proof."
const DUPLICATE_PROOF_IMAGE_SUBQUERY = `
  (SELECT COUNT(*) FROM orders o2
   WHERE o2.business_id = o.business_id AND o2.payment_proof_image = o.payment_proof_image)
`;

export async function getAllOrders(req, res) {
  const { page, limit, offset } = parsePagination(req, 50);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM orders WHERE business_id = ?', [req.business.id]);
  const [orders] = await pool.query(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
            CASE WHEN o.payment_reference IS NOT NULL AND o.payment_reference != '' AND ${DUPLICATE_REFERENCE_SUBQUERY} > 1
                 THEN 1 ELSE 0 END AS is_duplicate_reference,
            CASE WHEN o.payment_proof_image IS NOT NULL AND o.payment_proof_image != '' AND ${DUPLICATE_PROOF_IMAGE_SUBQUERY} > 1
                 THEN 1 ELSE 0 END AS is_duplicate_proof_image
     FROM orders o JOIN users u ON o.user_id = u.id
     WHERE o.business_id = ?
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.business.id, limit, offset]
  );
  res.json(buildPaginatedResponse('orders', orders, total, page, limit));
}

export async function getNewOrders(req, res) {
  const sinceId = Number(req.query.since_id) || 0;
  const [orders] = await pool.query(
    `SELECT o.id, o.total_amount, o.created_at, u.name AS customer_name
     FROM orders o JOIN users u ON o.user_id = u.id
     WHERE o.business_id = ? AND o.id > ?
     ORDER BY o.id DESC LIMIT 20`,
    [req.business.id, sinceId]
  );
  const [[{ maxId }]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM orders WHERE business_id = ?', [req.business.id]);
  res.json({ orders, latestId: maxId });
}

export async function getOrderById(req, res) {
  const [orders] = await pool.query(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email,
            CASE WHEN o.payment_reference IS NOT NULL AND o.payment_reference != '' AND ${DUPLICATE_REFERENCE_SUBQUERY} > 1
                 THEN 1 ELSE 0 END AS is_duplicate_reference,
            CASE WHEN o.payment_proof_image IS NOT NULL AND o.payment_proof_image != '' AND ${DUPLICATE_PROOF_IMAGE_SUBQUERY} > 1
                 THEN 1 ELSE 0 END AS is_duplicate_proof_image
     FROM orders o JOIN users u ON o.user_id = u.id WHERE o.business_id = ? AND o.id = ?`,
    [req.business.id, req.params.id]
  );
  if (orders.length === 0) return res.status(404).json({ error: 'Order not found' });
  const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
  res.json({ ...orders[0], items });
}

const VALID_STATUSES = ['pending_payment', 'pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'cancelled'];

export const STATUS_TRANSITIONS = {
  pending:           ['confirmed', 'cancelled'],
  confirmed:         ['packed', 'cancelled'],
  packed:            ['shipped', 'cancelled'],
  shipped:           ['out_for_delivery'],
  out_for_delivery:  ['delivered', 'returned'],
  delivered:         ['returned'],
  returned:          [],
  cancelled:         [],
  pending_payment:   [],
};

// Both terminal "give the stock back" transitions — cancelling before fulfillment, or a
// post-delivery return. Neither is reachable from the other in STATUS_TRANSITIONS, so this only
// ever fires once per order.
const STOCK_RESTORING_STATUSES = ['cancelled', 'returned'];

// Mirrors createOrder's stock decrement in reverse. Must run on the same connection/transaction
// as the status-transition UPDATE that calls it, so a crash between the two can't leave stock
// restored without the status actually changing (or vice versa).
async function restoreOrderStock(connection, businessId, orderId) {
  const [items] = await connection.query(
    'SELECT product_ref, variant_id, quantity FROM order_items WHERE order_id = ?',
    [orderId]
  );
  for (const item of items) {
    if (item.variant_id != null) {
      await connection.query(
        'UPDATE product_variants SET stock = stock + ? WHERE id = ? AND business_id = ?',
        [item.quantity, item.variant_id, businessId]
      );
      // products.stock mirrors the sum of variant stocks, same as the decrement side in
      // createOrder — keep it in sync here rather than leaving it stale.
      await connection.query(
        'UPDATE products SET stock = stock + ? WHERE id = ? AND business_id = ?',
        [item.quantity, item.product_ref, businessId]
      );
    } else {
      await connection.query(
        'UPDATE products SET stock = stock + ? WHERE id = ? AND business_id = ?',
        [item.quantity, item.product_ref, businessId]
      );
    }
  }
}

function buildStatusEmail(status, id, order, tpl = null, storeName) {
  const name = order.shipping_name || order.customer_name || 'there';
  const storeUrl = FRONTEND_URL;
  const vars = { name, order_id: id, tracking_number: order.tracking_number || '', courier: order.courier_name || '' };

  const configs = {
    confirmed: {
      subject: `Order #${id} confirmed ✓`,
      preheader: `Great news — your order #${id} has been confirmed.`,
      badge: { text: 'Confirmed', color: '#d4af37' },
      message: `Great news! Your order has been confirmed and our team is now preparing it for dispatch.`,
      extra: '',
    },
    packed: {
      subject: `Order #${id} is packed and ready`,
      preheader: `Your order #${id} has been packed.`,
      badge: { text: 'Packed', color: '#7d9fc0' },
      message: `Your order has been carefully packed and will be handed to the courier very soon.`,
      extra: '',
    },
    shipped: {
      subject: `Order #${id} is on its way! 🚚`,
      preheader: `Your order #${id} has shipped.`,
      badge: { text: 'Shipped', color: '#102b53' },
      message: order.tracking_number
        ? `Your order has shipped via <strong>${escapeHtml(order.courier_name) || 'our courier partner'}</strong>. Use the tracking number below to follow your package.`
        : `Your order has shipped and is on its way to you via our courier partner.`,
      extra: order.tracking_number
        ? emailOrderTable([
            { label: 'Courier', value: order.courier_name || 'Courier Partner' },
            { label: 'Tracking Number', value: order.tracking_number, bold: true },
          ]) + (order.tracking_url ? emailButton('Track My Package', order.tracking_url) : '')
        : '',
    },
    out_for_delivery: {
      subject: `Order #${id} is out for delivery today!`,
      preheader: `Your order #${id} is on the way to you right now.`,
      badge: { text: 'Out for Delivery', color: '#b8932e' },
      message: `Your order is out for delivery and should arrive at your door today. Please make sure someone is available to receive it.`,
      extra: '',
    },
    delivered: {
      subject: `Order #${id} delivered — enjoy! 🎉`,
      preheader: `Your order #${id} has been delivered.`,
      badge: { text: 'Delivered', color: '#2e7d32' },
      message: `Your order has been delivered. We hope you love your purchase! If you have any questions or concerns, feel free to reach out.`,
      extra: emailButton('Shop Again', storeUrl),
    },
    cancelled: {
      subject: `Order #${id} has been cancelled`,
      preheader: `Your order #${id} was cancelled.`,
      badge: { text: 'Cancelled', color: '#c62828' },
      message: `Your order has been cancelled. If you did not request this cancellation or have any questions, please contact us immediately.`,
      extra: '',
    },
    returned: {
      subject: `Order #${id} return processed`,
      preheader: `Return for order #${id} has been processed.`,
      badge: { text: 'Returned', color: '#7b1fa2' },
      message: `Your return for order #${id} has been processed. If you have questions about your refund or exchange, please contact us.`,
      extra: '',
    },
  };

  const cfg = configs[status];
  if (!cfg) return null;

  const subject = tpl?.subject ? applyPlaceholders(tpl.subject, vars) : cfg.subject;
  const message = tpl?.message ? applyPlaceholders(tpl.message, vars) : cfg.message;

  const body =
    emailGreeting(name) +
    `<p style="margin:0 0 20px;">${emailStatusBadge(cfg.badge.text, cfg.badge.color)}</p>` +
    emailOrderTable([{ label: 'Order Number', value: `#${id}`, bold: true }]) +
    emailParagraph(message) +
    cfg.extra +
    emailDivider() +
    emailParagraph("<span style='color:#888;font-size:13px;'>Thank you for shopping with us.</span>");

  return { subject, html: wrapEmail(body, { storeName, preheader: cfg.preheader }) };
}

const STATUS_EMAIL = {
  confirmed:        { build: (id, order) => buildStatusEmail('confirmed', id, order) },
  packed:           { build: (id, order) => buildStatusEmail('packed', id, order) },
  shipped:          { build: (id, order) => buildStatusEmail('shipped', id, order) },
  out_for_delivery: { build: (id, order) => buildStatusEmail('out_for_delivery', id, order) },
  delivered:        { build: (id, order) => buildStatusEmail('delivered', id, order) },
  cancelled:        { build: (id, order) => buildStatusEmail('cancelled', id, order) },
  returned:         { build: (id, order) => buildStatusEmail('returned', id, order) },
};

async function sendStatusChangeEmail(businessId, orderId, status) {
  const template = STATUS_EMAIL[status];
  if (!template) return;

  const [rows] = await pool.query(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ? AND o.business_id = ?`,
    [orderId, businessId]
  );
  const order = rows[0];
  const to = order?.email || order?.customer_email;
  if (!to) return;

  const courierSettings = await getCourierSettings(businessId);
  order.tracking_url = buildTrackingUrl(order.tracking_number, courierSettings.tracking_url_template);

  const STATUS_TO_TEMPLATE_KEY = {
    confirmed: 'order_confirmed', packed: 'order_packed', shipped: 'order_shipped',
    out_for_delivery: 'order_out_for_delivery', delivered: 'order_delivered',
    cancelled: 'order_cancelled', returned: 'order_returned',
  };
  const [emailTpl, storeName] = await Promise.all([
    getEmailTemplate(businessId, STATUS_TO_TEMPLATE_KEY[status] || '').catch(() => null),
    getSiteName(businessId),
  ]);
  const tplVars = { name: order.shipping_name || order.customer_name || 'there', order_id: order.id };

  if (status === 'confirmed') {
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    const name = tplVars.name;
    const subject = emailTpl?.subject ? applyPlaceholders(emailTpl.subject, tplVars) : `Order #${order.id} confirmed ✓`;
    const message = emailTpl?.message ? applyPlaceholders(emailTpl.message, tplVars) : 'Great news! Your order has been confirmed and our team is now preparing it for dispatch.';
    const body =
      emailGreeting(name) +
      `<p style="margin:0 0 20px;">${emailStatusBadge('Confirmed', '#d4af37')}</p>` +
      emailParagraph(message) +
      emailInvoiceBlock(order, items) +
      emailDivider() +
      emailParagraph("<span style='color:#888;font-size:13px;'>Thank you for shopping with us.</span>");
    sendMail({
      to,
      subject,
      html: wrapEmail(body, { storeName, preheader: `Great news — your order #${order.id} has been confirmed.` }),
    });
    return;
  }

  const built = buildStatusEmail(status, order.id, order, emailTpl, storeName);
  if (!built) return;
  sendMail({ to, subject: built.subject, html: built.html });
}

export async function updateOrderStatus(req, res) {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const [current] = await pool.query('SELECT * FROM orders WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (current.length === 0) return res.status(404).json({ error: 'Order not found' });
  const order = current[0];
  const allowed = STATUS_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Cannot move from ${order.status} to ${status}` });

  const deliveredSet = status === 'delivered' ? ', delivered_at = NOW()' : '';
  const restoresStock = STOCK_RESTORING_STATUSES.includes(status);

  // Claim the transition atomically *before* booking a real courier shipment below. Booking
  // first (the old order) meant two concurrent requests could both pass the checks above and
  // both book a real Leopards shipment; only one would win this update, leaving the loser's
  // booking orphaned (real money spent, no record of it anywhere). Guarding on the status we
  // read above also means two admins acting on the same order at the same instant can't
  // silently overwrite each other — the loser gets a clear conflict instead of a lost update.
  //
  // Cancelling/returning additionally restores stock, on the same connection so both changes
  // commit or roll back together.
  const connection = restoresStock ? await pool.getConnection() : pool;
  try {
    if (restoresStock) await connection.beginTransaction();

    const [claimResult] = await connection.query(
      `UPDATE orders SET status = ?${deliveredSet} WHERE id = ? AND business_id = ? AND status = ?`,
      [status, req.params.id, req.business.id, order.status],
    );
    if (claimResult.affectedRows === 0) {
      if (restoresStock) await connection.rollback();
      return res.status(409).json({ error: 'This order was updated by someone else. Please refresh and try again.' });
    }

    if (restoresStock) {
      await restoreOrderStock(connection, req.business.id, req.params.id);
      await connection.commit();
    }
  } catch (err) {
    if (restoresStock) await connection.rollback();
    throw err;
  } finally {
    if (restoresStock) connection.release();
  }

  // Auto-book with Leopards the moment an order is marked Shipped, unless the
  // admin already entered a tracking number manually for this order. Only runs now that this
  // request has confirmed it actually won the transition above.
  let booked = null;
  let courierWarning = null;
  if (status === 'shipped' && !order.tracking_number) {
    try {
      const courierSettings = await getCourierSettings(req.business.id);
      if (courierSettings.enabled && isLeopardsProvider(courierSettings.provider)) {
        booked = await bookLeopardsPacket(req.business.id, order);
        await pool.query(
          'UPDATE orders SET courier_name = ?, tracking_number = ? WHERE id = ? AND business_id = ?',
          ['Leopards Courier', booked.trackNumber, req.params.id, req.business.id],
        );
      }
    } catch (err) {
      courierWarning = err.message;
    }
  }

  res.json({
    message: 'Order status updated',
    ...(booked ? { courier_name: 'Leopards Courier', tracking_number: booked.trackNumber } : {}),
    ...(courierWarning ? { courier_warning: courierWarning } : {}),
  });

  logAudit({
    req, action: 'order.status_change', entityType: 'order', entityId: req.params.id,
    details: { status: { from: order.status, to: status } },
  });
  sendStatusChangeEmail(req.business.id, req.params.id, status).catch((err) => logger.error({ err, orderId: req.params.id, status }, 'Order status email failed'));
}

// Lets the periodic Leopards tracking sync move an order's status forward.
// Reuses the same STATUS_TRANSITIONS state machine as the admin-driven update
// so an out-of-order/unexpected courier status can never corrupt order state.
export async function applySyncedOrderStatus(businessId, orderId, currentStatus, newStatus) {
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) return false;

  const deliveredSet = newStatus === 'delivered' ? ', delivered_at = NOW()' : '';
  // Leopards can report a package as returned-to-shipper (mapLeopardsStatus), so this background
  // path needs the same stock restoration as the admin-driven update above.
  const restoresStock = STOCK_RESTORING_STATUSES.includes(newStatus);

  const connection = restoresStock ? await pool.getConnection() : pool;
  let applied = false;
  try {
    if (restoresStock) await connection.beginTransaction();

    // Guarded on currentStatus, same as updateOrderStatus's admin-driven path — without it, this
    // background sync could silently overwrite a status an admin already changed in the meantime
    // (e.g. flip a just-cancelled order back to "delivered" and email the customer accordingly).
    const [result] = await connection.query(
      `UPDATE orders SET status = ?${deliveredSet} WHERE id = ? AND business_id = ? AND status = ?`,
      [newStatus, orderId, businessId, currentStatus]
    );
    applied = result.affectedRows > 0;

    if (applied && restoresStock) {
      await restoreOrderStock(connection, businessId, orderId);
      await connection.commit();
    } else if (restoresStock) {
      await connection.rollback();
    }
  } catch (err) {
    if (restoresStock) await connection.rollback();
    throw err;
  } finally {
    if (restoresStock) connection.release();
  }

  if (!applied) return false;
  await sendStatusChangeEmail(businessId, orderId, newStatus);
  return true;
}

export async function bookOrderCourier(req, res) {
  const [rows] = await pool.query('SELECT * FROM orders WHERE id = ? AND business_id = ?', [req.params.id, req.business.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
  const order = rows[0];
  if (order.tracking_number) return res.status(400).json({ error: 'This order already has a tracking number.' });

  try {
    const booked = await bookLeopardsPacket(req.business.id, order);
    await pool.query(
      'UPDATE orders SET courier_name = ?, tracking_number = ? WHERE id = ? AND business_id = ?',
      ['Leopards Courier', booked.trackNumber, req.params.id, req.business.id]
    );
    res.json({ message: 'Booked with Leopards', courier_name: 'Leopards Courier', tracking_number: booked.trackNumber });
  } catch (err) {
    // bookLeopardsPacket's own throws are always hand-written, meant-for-the-client messages
    // (settings misconfigured, city not recognized, Leopards rejected the booking) — but a raw
    // DB error surfacing here (e.g. the settings lookup losing its connection) isn't, so let
    // that fall through to the global handler instead of echoing it as a 400.
    if (isDbError(err)) throw err;
    res.status(400).json({ error: err.message });
  }
}

export async function downloadInvoice(req, res) {
  try {
    const pdfBuf = await generateInvoicePdf(req.params.id, req.business.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.id}.pdf"`);
    res.end(pdfBuf);
  } catch (err) {
    if (err.message === 'Order not found') return res.status(404).json({ error: 'Order not found' });
    throw err;
  }
}

export async function updateOrderTracking(req, res) {
  const { courier_name, tracking_number } = req.body;
  const [result] = await pool.query(
    'UPDATE orders SET courier_name = ?, tracking_number = ? WHERE id = ? AND business_id = ?',
    [courier_name || null, tracking_number || null, req.params.id, req.business.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Order not found' });
  res.json({ message: 'Tracking info updated' });
}
