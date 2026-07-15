import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailGreeting, emailParagraph, emailButton, emailDivider, escapeHtml } from '../utils/emailTemplate.js';
import { getEmailTemplate, applyPlaceholders } from '../utils/emailLoader.js';
import { verifyUnsubscribeToken, buildUnsubscribeUrl } from '../utils/unsubscribeToken.js';
import { buildStoreUrl } from '../utils/storeUrl.js';
import { getSiteName } from './contentController.js';
import { EMAIL_PATTERN } from '../utils/validation.js';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination.js';

async function buildWelcomeEmail(business, email) {
  const [tpl, storeName] = await Promise.all([
    getEmailTemplate(business.id, 'newsletter_welcome').catch(() => null),
    getSiteName(business.id),
  ]);
  const subject = tpl?.subject || "You're subscribed! 🎉";
  const message = tpl?.message
    ? applyPlaceholders(tpl.message, {})
    : "Thanks for subscribing to our newsletter! You'll be the first to know about new arrivals, sales, and exclusive offers.";
  const storeUrl = buildStoreUrl(business.slug);
  const body =
    emailGreeting() +
    emailParagraph(message) +
    emailButton('Start Shopping', storeUrl) +
    emailDivider() +
    emailParagraph("<span style='color:#888;font-size:13px;'>You're receiving this because you subscribed to our newsletter.</span>");
  return { subject, html: wrapEmail(body, { storeName, preheader: 'Welcome to the list!', unsubscribeUrl: buildUnsubscribeUrl(business, email) }) };
}

export async function subscribe(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  const [existing] = await pool.query(
    'SELECT id, unsubscribed_at FROM newsletter_subscribers WHERE business_id = ? AND email = ?',
    [req.business.id, email],
  );

  // "New" covers both a first-time subscribe and a re-subscribe after a
  // previous unsubscribe — both should clear the suppression and send the welcome email.
  let isNew = existing.length === 0 || existing[0].unsubscribed_at != null;
  if (existing.length === 0) {
    try {
      await pool.query(
        'INSERT INTO newsletter_subscribers (business_id, email) VALUES (?, ?)',
        [req.business.id, email],
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      isNew = false; // lost a race with a concurrent subscribe for the same email
    }
  } else if (existing[0].unsubscribed_at != null) {
    await pool.query('UPDATE newsletter_subscribers SET unsubscribed_at = NULL WHERE id = ?', [existing[0].id]);
  }

  if (isNew) {
    buildWelcomeEmail(req.business, email).then(({ subject, html }) => {
      sendMail({ to: email, subject, html });
    }).catch(() => {});
  }

  res.status(201).json({ message: isNew ? 'Subscribed' : 'Already subscribed', alreadySubscribed: !isNew });
}

export async function checkStatus(req, res) {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return res.json({ subscribed: false });

  const [rows] = await pool.query(
    'SELECT id FROM newsletter_subscribers WHERE business_id = ? AND email = ? AND unsubscribed_at IS NULL',
    [req.business.id, email]
  );
  res.json({ subscribed: rows.length > 0 });
}

export async function unsubscribe(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { token } = req.body;
  if (!EMAIL_PATTERN.test(email) || !verifyUnsubscribeToken(req.business.id, email, token)) {
    return res.status(400).json({ error: 'This unsubscribe link is invalid or has expired.' });
  }

  await pool.query(
    'UPDATE newsletter_subscribers SET unsubscribed_at = NOW() WHERE business_id = ? AND email = ? AND unsubscribed_at IS NULL',
    [req.business.id, email]
  );
  res.json({ message: 'Unsubscribed' });
}

export async function adminList(req, res) {
  const { page, limit, offset } = parsePagination(req, 50);
  const [[{ total, activeTotal }]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(unsubscribed_at IS NULL) AS activeTotal
     FROM newsletter_subscribers WHERE business_id = ?`,
    [req.business.id]
  );
  const [rows] = await pool.query(
    'SELECT id, email, unsubscribed_at, created_at FROM newsletter_subscribers WHERE business_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [req.business.id, limit, offset]
  );
  // activeTotal is the real count adminSend below actually emails — the current page's table
  // rows are just what's displayed, and shouldn't be confused with how many will receive a send.
  res.json({ ...buildPaginatedResponse('subscribers', rows, total, page, limit), activeTotal: Number(activeTotal) });
}

// Polled by the admin "new subscriber" notification bell — mirrors getNewOrders in
// ordersController.js exactly (same since_id/latestId contract, same bootstrap-on-first-run
// behavior client-side).
export async function getNewSubscribers(req, res) {
  const sinceId = Number(req.query.since_id) || 0;
  const [subscribers] = await pool.query(
    'SELECT id, email, created_at FROM newsletter_subscribers WHERE business_id = ? AND id > ? ORDER BY id DESC LIMIT 20',
    [req.business.id, sinceId]
  );
  const [[{ maxId }]] = await pool.query(
    'SELECT COALESCE(MAX(id), 0) AS maxId FROM newsletter_subscribers WHERE business_id = ?',
    [req.business.id]
  );
  res.json({ subscribers, latestId: maxId });
}

export async function adminDelete(req, res) {
  const [result] = await pool.query(
    'DELETE FROM newsletter_subscribers WHERE id = ? AND business_id = ?',
    [req.params.id, req.business.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Subscriber not found' });
  res.json({ message: 'Removed' });
}

export async function adminSend(req, res) {
  const { subject, message } = req.body;
  if (!subject?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'subject and message are required' });
  }

  const [rows] = await pool.query(
    'SELECT email FROM newsletter_subscribers WHERE business_id = ? AND unsubscribed_at IS NULL',
    [req.business.id]
  );
  if (rows.length === 0) return res.json({ sent: 0 });

  const paragraphs = message
    .trim()
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => emailParagraph(escapeHtml(block).replace(/\n/g, '<br/>')))
    .join('');
  const body = paragraphs + emailDivider() +
    emailParagraph("<span style='color:#888;font-size:13px;'>You are receiving this because you subscribed to our newsletter.</span>");

  const storeName = await getSiteName(req.business.id);
  for (const row of rows) {
    const html = wrapEmail(body, { storeName, preheader: subject.trim(), unsubscribeUrl: buildUnsubscribeUrl(req.business, row.email) });
    sendMail({ to: row.email, subject: subject.trim(), html });
  }
  res.json({ sent: rows.length });
}
