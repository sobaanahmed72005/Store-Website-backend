import pool from '../config/db.js';
import { sendMail } from './mailer.js';
import { wrapEmail, emailGreeting, emailParagraph, emailDivider, escapeHtml } from './emailTemplate.js';
import { getEmailTemplate, applyPlaceholders } from './emailLoader.js';

const GOLD_LIGHT = '#fbf3dc';
const PRIMARY    = '#102b53';
const TEXT       = '#212121';
const MUTED      = '#666666';

export async function sendReviewReminders() {
  try {
    const [orders] = await pool.query(
      `SELECT id, email, shipping_name, delivered_at, business_id
       FROM orders
       WHERE status = 'delivered'
         AND review_reminder_sent_at IS NULL
         AND delivered_at IS NOT NULL
         AND delivered_at <= DATE_SUB(NOW(), INTERVAL 14 DAY)
         AND email IS NOT NULL`,
    );

    for (const order of orders) {
      try {
        const [items] = await pool.query(
          `SELECT oi.product_name, p.slug AS product_slug
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_ref AND p.business_id = ?
           WHERE oi.order_id = ?`,
          [order.business_id, order.id],
        );

        if (!items.length) continue;

        const storeUrl  = process.env.FRONTEND_URL || 'http://localhost:5173';
        const name      = order.shipping_name || 'there';
        const orderDate = new Date(order.delivered_at).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'long', year: 'numeric',
        });

        const productRows = items.map((item) => {
          const url = item.product_slug
            ? `${storeUrl}/product/${item.product_slug}`
            : storeUrl;
          return `
            <tr>
              <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;">
                <span style="font-size:14px;color:${TEXT};display:block;margin-bottom:4px;">${escapeHtml(item.product_name)}</span>
                <a href="${url}"
                   style="font-size:13px;font-weight:700;color:${PRIMARY};text-decoration:none;">
                  ★ Write a Review →
                </a>
              </td>
            </tr>`;
        }).join('');

        const reminderTpl = await getEmailTemplate(order.business_id, 'review_reminder').catch(() => null);
        const tplVars = { name, order_id: order.id };
        const reminderSubject = reminderTpl?.subject
          ? applyPlaceholders(reminderTpl.subject, tplVars)
          : `How was your order #${order.id}? Share your review ⭐`;
        const reminderMessage = reminderTpl?.message
          ? applyPlaceholders(reminderTpl.message, tplVars)
          : `It's been 2 weeks since your order <strong>#${order.id}</strong> was delivered on <strong>${orderDate}</strong>. Your honest review helps other customers make the right choice. It only takes a minute:`;

        const body =
          emailGreeting(name) +
          emailParagraph(reminderMessage) +
          `<table width="100%" cellpadding="0" cellspacing="0" border="0"
                  style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin:0 0 24px;">
             <tr>
               <td style="background:${GOLD_LIGHT};padding:12px 20px;font-size:13px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.5px;">
                 Your Purchased Products
               </td>
             </tr>
             ${productRows}
           </table>` +
          emailDivider() +
          `<p style="margin:0;font-size:12px;color:${MUTED};">
             You received this email because you placed an order with us. Reviews are optional and always welcome.
           </p>`;

        await sendMail({
          to:      order.email,
          subject: reminderSubject,
          html:    wrapEmail(body, {
            preheader: `Your order was delivered 2 weeks ago — we'd love to hear what you think!`,
          }),
        });

        await pool.query(
          'UPDATE orders SET review_reminder_sent_at = NOW() WHERE id = ?',
          [order.id],
        );
      } catch (err) {
        console.error(`Review reminder failed for order ${order.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Review reminder job error:', err.message);
  }
}