import pool from '../config/db.js';
import { sendMail } from '../utils/mailer.js';
import { wrapEmail, emailParagraph, emailDivider, escapeHtml } from '../utils/emailTemplate.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getStoreContactEmail(businessId) {
  const [rows] = await pool.query(
    'SELECT value FROM site_content WHERE business_id = ? AND content_key = ?',
    [businessId, 'footer-brand'],
  );
  const value = rows.length ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : null;
  return value?.email || process.env.SMTP_USER || null;
}

export async function sendMessage(req, res) {
  const { name, email, subject, message } = req.body;
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'name, email and message are required' });
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  const storeEmail = await getStoreContactEmail(req.business.id);
  if (!storeEmail) {
    return res.status(500).json({ error: 'This store has not configured a contact email yet' });
  }

  const body =
    emailParagraph(`<strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})`) +
    (subject?.trim() ? emailParagraph(`<strong>Subject:</strong> ${escapeHtml(subject)}`) : '') +
    emailDivider() +
    emailParagraph(escapeHtml(message).replace(/\n/g, '<br/>'));

  await sendMail({
    to: storeEmail,
    subject: subject?.trim() ? `Contact form: ${subject.trim()}` : `New message from ${name.trim()}`,
    html: wrapEmail(body, { preheader: 'New message from your website contact form' }),
    replyTo: email.trim(),
  });

  res.json({ message: 'Message sent' });
}
