import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailGreeting, emailButton, emailParagraph, emailOrderTable, emailStatusBadge, emailDivider, emailInvoiceBlock } from '../utils/emailTemplate.js';
import { resolveDiscount } from './discountCodesController.js';
import { getCourierSettings, buildTrackingUrl, bookLeopardsPacket, isLeopardsProvider } from './courierController.js';
import { generateInvoicePdf } from '../utils/invoiceGenerator.js';
import { getEmailTemplate, applyPlaceholders } from '../utils/emailLoader.js';

function effectivePrice(product) {
  return product.is_on_sale && product.discount_price != null ? Number(product.discount_price) : Number(product.price);
}

export async function createOrder(req, res) {
  const { shipping_name, shipping_address, shipping_city, phone, email, notes, items, discount_code, payment_method, payment_reference } = req.body;
  const user_id = req.user.id;
  if (!shipping_address || !phone || !items?.length) {
    return res.status(400).json({ error: 'shipping_address, phone and items are required' });
  }

  let isSafepay = false;
  if (payment_method === 'safepay') {
    const [gwRows] = await pool.query(
      "SELECT enabled, api_key, secret_key FROM payment_gateways WHERE business_id = ? AND provider = 'safepay'",
      [req.business.id]
    );
    if (!gwRows.length || !gwRows[0].enabled || !gwRows[0].api_key || !gwRows[0].secret_key) {
      return res.status(400).json({ error: 'Safepay is not enabled for this store' });
    }
    isSafepay = true;
  } else {
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

  const requestedQtyByProduct = new Map();
  for (const item of items) {
    const key = String(item.id);
    requestedQtyByProduct.set(key, (requestedQtyByProduct.get(key) ?? 0) + Math.trunc(Number(item.quantity)));
  }
  for (const [productIdKey, requestedQty] of requestedQtyByProduct) {
    const product = productById.get(productIdKey);
    if (requestedQty > product.stock) {
      return res.status(400).json({ error: `Only ${product.stock} of "${product.name}" left in stock` });
    }
  }

  const orderItems = items.map((item) => {
    const product = productById.get(String(item.id));
    const quantity = Math.trunc(Number(item.quantity));
    return { product, quantity, price: effectivePrice(product) };
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
        return res.status(err.status || 400).json({ error: err.message });
      }
    }

    const totalAmount = subtotal + shippingFee - discountAmount;
    const orderStatus = isSafepay ? 'pending_payment' : 'pending';
    const [orderResult] = await connection.query(
      `INSERT INTO orders (business_id, user_id, total_amount, shipping_fee, discount_code, discount_amount, shipping_name, shipping_address, shipping_city, phone, email, notes, payment_method, payment_reference, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.business.id, user_id, totalAmount, shippingFee, resolvedDiscount?.code ?? null, discountAmount,
        shipping_name ?? null, shipping_address, shipping_city ?? null, phone, email ?? null, notes ?? null,
        payment_method, payment_reference ?? null, orderStatus,
      ]
    );
    const orderId = orderResult.insertId;

    for (const item of orderItems) {
      const isSalePrice = item.price < Number(item.product.price) ? 1 : 0;
      await connection.query(
        'INSERT INTO order_items (order_id, product_ref, product_name, product_image, quantity, price, is_sale_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, String(item.product.id), item.product.name, item.product.image ?? null, item.quantity, item.price, isSalePrice]
      );
    }

    if (resolvedDiscount) {
      await connection.query(
        'INSERT INTO discount_code_redemptions (discount_code_id, user_id, order_id) VALUES (?, ?, ?)',
        [resolvedDiscount.id, user_id, orderId]
      );
    }

    await connection.commit();
    res.status(201).json({ id: orderId, total_amount: totalAmount });

    // Persist shipping details on the user record so checkout pre-fills next time
    pool.query(
      'UPDATE users SET saved_phone = ?, saved_address = ?, saved_city = ? WHERE id = ?',
      [phone || null, shipping_address || null, shipping_city || null, user_id]
    ).catch(() => {});

    if (email) {
      const orderTpl = await getEmailTemplate(req.business.id, 'order_received').catch(() => null);
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
          { label: 'Payment', value: payment_method === 'cod' ? 'Cash on Delivery' : payment_method === 'safepay' ? 'Safepay (Online)' : 'Bank / Wallet Transfer' },
          { label: 'Shipping to', value: `${shipping_city || ''}${shipping_city ? ', ' : ''}${shipping_address}` },
        ]) +
        emailParagraph("You'll receive another email as soon as your order is confirmed. If you have any questions, simply reply to this email.") +
        emailDivider() +
        emailParagraph("<span style='color:#888;font-size:13px;'>Please keep this email for your records.</span>");
      sendMail({
        to: email,
        subject: orderSubject,
        html: wrapEmail(body, { preheader: `Your order #${orderId} has been received.` }),
      });
    }
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function getOrdersByUser(req, res) {
  const { userId } = req.params;
  const [orders] = await pool.query('SELECT * FROM orders WHERE business_id = ? AND user_id = ? ORDER BY created_at DESC', [req.business.id, userId]);
  const courierSettings = await getCourierSettings(req.business.id);
  for (const order of orders) {
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    order.items = items;
    order.tracking_url = buildTrackingUrl(order.tracking_number, courierSettings.tracking_url_template);
  }
  res.json(orders);
}

export async function getAllOrders(req, res) {
  const [orders] = await pool.query(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
     FROM orders o JOIN users u ON o.user_id = u.id
     WHERE o.business_id = ?
     ORDER BY o.created_at DESC`,
    [req.business.id]
  );
  res.json(orders);
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
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email
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
  out_for_delivery:  ['delivered'],
  delivered:         ['returned'],
  returned:          [],
  cancelled:         [],
  pending_payment:   [],
};

function buildStatusEmail(status, id, order, tpl = null) {
  const name = order.shipping_name || order.customer_name || 'there';
  const storeUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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
        ? `Your order has shipped via <strong>${order.courier_name || 'our courier partner'}</strong>. Use the tracking number below to follow your package.`
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

  return { subject, html: wrapEmail(body, { preheader: cfg.preheader }) };
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
  const emailTpl = await getEmailTemplate(businessId, STATUS_TO_TEMPLATE_KEY[status] || '').catch(() => null);
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
      html: wrapEmail(body, { preheader: `Great news — your order #${order.id} has been confirmed.` }),
    });
    return;
  }

  const built = buildStatusEmail(status, order.id, order, emailTpl);
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

  // Auto-book with Leopards the moment an order is marked Shipped, unless the
  // admin already entered a tracking number manually for this order.
  let booked = null;
  let courierWarning = null;
  if (status === 'shipped' && !order.tracking_number) {
    try {
      const courierSettings = await getCourierSettings(req.business.id);
      if (courierSettings.enabled && isLeopardsProvider(courierSettings.provider)) {
        booked = await bookLeopardsPacket(req.business.id, order);
      }
    } catch (err) {
      courierWarning = err.message;
    }
  }

  const deliveredSet = status === 'delivered' ? ', delivered_at = NOW()' : '';
  const trackingSet = booked ? ', courier_name = ?, tracking_number = ?' : '';
  await pool.query(
    `UPDATE orders SET status = ?${deliveredSet}${trackingSet} WHERE id = ? AND business_id = ?`,
    [status, ...(booked ? ['Leopards Courier', booked.trackNumber] : []), req.params.id, req.business.id],
  );
  res.json({
    message: 'Order status updated',
    ...(booked ? { courier_name: 'Leopards Courier', tracking_number: booked.trackNumber } : {}),
    ...(courierWarning ? { courier_warning: courierWarning } : {}),
  });

  sendStatusChangeEmail(req.business.id, req.params.id, status).catch((err) => console.error('[order status email] failed:', err.message));
}

// Lets the periodic Leopards tracking sync move an order's status forward.
// Reuses the same STATUS_TRANSITIONS state machine as the admin-driven update
// so an out-of-order/unexpected courier status can never corrupt order state.
export async function applySyncedOrderStatus(businessId, orderId, currentStatus, newStatus) {
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) return false;

  const deliveredSet = newStatus === 'delivered' ? ', delivered_at = NOW()' : '';
  await pool.query(`UPDATE orders SET status = ?${deliveredSet} WHERE id = ? AND business_id = ?`, [newStatus, orderId, businessId]);
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
