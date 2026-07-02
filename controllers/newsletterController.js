import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailGreeting, emailParagraph, emailButton, emailDivider } from '../utils/emailTemplate.js';
import { getEmailTemplate, applyPlaceholders } from '../utils/emailLoader.js';
import { generateUnsubscribeToken, verifyUnsubscribeToken } from '../utils/unsubscribeToken.js';
import { buildStoreUrl } from '../utils/storeUrl.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildUnsubscribeUrl(business, email) {
  const token = generateUnsubscribeToken(business.id, email);
  return `${buildStoreUrl(business.slug)}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

async function buildWelcomeEmail(business, email) {
  const tpl = await getEmailTemplate(business.id, 'newsletter_welcome').catch(() => null);
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
  return { subject, html: wrapEmail(body, { preheader: 'Welcome to the list!', unsubscribeUrl: buildUnsubscribeUrl(business, email) }) };
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
  const [rows] = await pool.query(
    'SELECT id, email, unsubscribed_at, created_at FROM newsletter_subscribers WHERE business_id = ? ORDER BY created_at DESC',
    [req.business.id]
  );
  res.json(rows);
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
    .map((block) => emailParagraph(block.replace(/\n/g, '<br/>')))
    .join('');
  const body = paragraphs + emailDivider() +
    emailParagraph("<span style='color:#888;font-size:13px;'>You are receiving this because you subscribed to our newsletter.</span>");

  for (const row of rows) {
    const html = wrapEmail(body, { preheader: subject.trim(), unsubscribeUrl: buildUnsubscribeUrl(req.business, row.email) });
    sendMail({ to: row.email, subject: subject.trim(), html });
  }
  res.json({ sent: rows.length });
}
