import pool from '../config/db.js';
import { escapeHtml } from './emailTemplate.js';

const TEMPLATE_DEFAULTS = {
  signup: {
    subject: 'Verify your email address',
    message: "Thanks for creating an account with us! To get started, please verify your email address by clicking the button below.",
  },
  order_received: {
    subject: 'Order #{{order_id}} received — thank you!',
    message: "Thanks for your order! We've received it and our team is reviewing it now. You'll receive another email as soon as your order is confirmed.",
  },
  order_confirmed: {
    subject: 'Order #{{order_id}} confirmed ✓',
    message: 'Great news! Your order has been confirmed and our team is now preparing it for dispatch.',
  },
  order_packed: {
    subject: 'Order #{{order_id}} is packed and ready',
    message: 'Your order has been carefully packed and will be handed to the courier very soon.',
  },
  order_shipped: {
    subject: 'Order #{{order_id}} is on its way! 🚚',
    message: 'Your order has shipped and is on its way to you via our courier partner.',
  },
  order_out_for_delivery: {
    subject: 'Order #{{order_id}} is out for delivery today!',
    message: 'Your order is out for delivery and should arrive at your door today. Please make sure someone is available to receive it.',
  },
  order_delivered: {
    subject: 'Order #{{order_id}} delivered — enjoy! 🎉',
    message: 'Your order has been delivered. We hope you love your purchase! If you have any questions or concerns, feel free to reach out.',
  },
  order_cancelled: {
    subject: 'Order #{{order_id}} has been cancelled',
    message: 'Your order has been cancelled. If you did not request this cancellation or have any questions, please contact us immediately.',
  },
  order_returned: {
    subject: 'Order #{{order_id}} return processed',
    message: 'Your return for order #{{order_id}} has been processed. If you have questions about your refund or exchange, please contact us.',
  },
  review_reminder: {
    subject: 'How was your order #{{order_id}}? Share your review ⭐',
    message: "It's been 2 weeks since your order was delivered. We hope you're enjoying your purchase! Your honest review helps other customers make the right choice. It only takes a minute:",
  },
  password_reset: {
    subject: 'Reset your password',
    message: 'We received a request to reset your password. Click the button below to choose a new one. If you did not request this, you can safely ignore this email — your password will not be changed.',
  },
  newsletter_welcome: {
    subject: "You're subscribed! 🎉",
    message: "Thanks for subscribing to our newsletter! You'll be the first to know about new arrivals, sales, and exclusive offers.",
  },
};

export async function getEmailTemplate(businessId, type) {
  const [rows] = await pool.query(
    'SELECT value FROM site_content WHERE business_id = ? AND content_key = ?',
    [businessId, 'email-templates'],
  );

  let stored = {};
  if (rows.length) {
    stored = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
  }

  const def = TEMPLATE_DEFAULTS[type] || { subject: '', message: '' };
  const tpl = stored[type] || {};
  return {
    subject: tpl.subject || def.subject,
    message: tpl.message || def.message,
  };
}

export function applyPlaceholders(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] != null ? escapeHtml(vars[key]) : `{{${key}}}`));
}