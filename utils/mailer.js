import nodemailer from 'nodemailer';
import { SMTP_CONFIG } from '../config/env.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: SMTP_CONFIG.HOST,
    port: Number(SMTP_CONFIG.PORT),
    secure: Number(SMTP_CONFIG.PORT) === 465,
    auth: { user: SMTP_CONFIG.USER, pass: SMTP_CONFIG.PASS },
  });
  return transporter;
}

export async function sendMail({ to, subject, html, attachments, replyTo }) {
  try {
    const from = SMTP_CONFIG.FROM;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    await getTransporter().sendMail({ from, to, subject, html, text, attachments, replyTo });
  } catch (err) {
    console.error('Failed to send email:', err.message);
  }
}
