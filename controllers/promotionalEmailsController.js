import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailParagraph, emailDivider } from '../utils/emailTemplate.js';
import { generateUnsubscribeToken } from '../utils/unsubscribeToken.js';
import { buildStoreUrl } from '../utils/storeUrl.js';

function buildUnsubscribeUrl(business, email) {
  const token = generateUnsubscribeToken(business.id, email);
  return `${buildStoreUrl(business.slug)}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

function buildPromoHtml({ subject, message, poster_image }, unsubscribeUrl) {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  const imageUrl = poster_image
    ? (poster_image.startsWith('http') ? poster_image : `${backendUrl}${poster_image}`)
    : null;

  const img = imageUrl
    ? `<img src="${imageUrl}" alt="" style="display:block;width:100%;max-width:600px;height:auto;border-radius:8px;margin:0 0 28px;" />`
    : '';

  const headlineBlock = `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#102b53;line-height:1.3;">${subject}</h2>`;

  const paragraphs = message
    .trim()
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => emailParagraph(block.replace(/\n/g, '<br/>')))
    .join('');

  const body =
    img +
    headlineBlock +
    paragraphs +
    emailDivider() +
    emailParagraph(
      "<span style='color:#888;font-size:12px;'>You are receiving this email because you subscribed to updates from our store.</span>",
    );

  return wrapEmail(body, { preheader: message.replace(/\n/g, ' ').slice(0, 100), unsubscribeUrl });
}

export async function adminList(req, res) {
  const [rows] = await pool.query(
    'SELECT * FROM promotional_emails WHERE business_id = ? ORDER BY created_at DESC',
    [req.business.id],
  );
  res.json(rows);
}

export async function adminCreate(req, res) {
  const { title, subject, message, poster_image } = req.body;
  if (!title?.trim() || !subject?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'title, subject and message are required' });
  }
  const [result] = await pool.query(
    'INSERT INTO promotional_emails (business_id, title, subject, message, poster_image) VALUES (?, ?, ?, ?, ?)',
    [req.business.id, title.trim(), subject.trim(), message.trim(), poster_image || null],
  );
  const [rows] = await pool.query('SELECT * FROM promotional_emails WHERE id = ?', [result.insertId]);
  res.status(201).json(rows[0]);
}

export async function adminUpdate(req, res) {
  const { title, subject, message, poster_image } = req.body;
  const [existing] = await pool.query(
    'SELECT * FROM promotional_emails WHERE id = ? AND business_id = ?',
    [req.params.id, req.business.id],
  );
  if (!existing.length) return res.status(404).json({ error: 'Not found' });
  const promo = existing[0];

  await pool.query(
    'UPDATE promotional_emails SET title = ?, subject = ?, message = ?, poster_image = ? WHERE id = ? AND business_id = ?',
    [
      title !== undefined ? title.trim() : promo.title,
      subject !== undefined ? subject.trim() : promo.subject,
      message !== undefined ? message.trim() : promo.message,
      poster_image !== undefined ? (poster_image || null) : promo.poster_image,
      req.params.id,
      req.business.id,
    ],
  );
  const [rows] = await pool.query('SELECT * FROM promotional_emails WHERE id = ?', [req.params.id]);
  res.json(rows[0]);
}

export async function adminDelete(req, res) {
  const [result] = await pool.query(
    'DELETE FROM promotional_emails WHERE id = ? AND business_id = ?',
    [req.params.id, req.business.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
}

export async function adminSend(req, res) {
  const [promoRows] = await pool.query(
    'SELECT * FROM promotional_emails WHERE id = ? AND business_id = ?',
    [req.params.id, req.business.id],
  );
  if (!promoRows.length) return res.status(404).json({ error: 'Not found' });
  const promo = promoRows[0];

  const [subscribers] = await pool.query(
    'SELECT email FROM newsletter_subscribers WHERE business_id = ? AND unsubscribed_at IS NULL',
    [req.business.id],
  );
  if (!subscribers.length) {
    return res.status(400).json({ error: 'No subscribers to send to' });
  }

  const count = subscribers.length;
  await pool.query(
    'UPDATE promotional_emails SET status = ?, sent_at = NOW(), recipient_count = ? WHERE id = ?',
    ['sent', count, promo.id],
  );

  res.json({ message: `Sending to ${count} subscriber${count === 1 ? '' : 's'}`, recipients: count });

  for (const sub of subscribers) {
    const html = buildPromoHtml(
      { subject: promo.subject, message: promo.message, poster_image: promo.poster_image },
      buildUnsubscribeUrl(req.business, sub.email)
    );
    sendMail({ to: sub.email, subject: promo.subject, html }).catch(() => {});
  }
}