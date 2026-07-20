import nodemailer from 'nodemailer';
import { RESEND_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } from '../config/env.js';
import { logger } from './logger.js';

const RESEND_API_URL = 'https://api.resend.com/emails';
// A plain HTTPS call, same timeout reasoning as the SMTP transport below — every caller either
// awaits this inline or backgrounds it off a request handler, so a stuck connection should fail
// fast rather than hang either the response or an unbounded background task.
const RESEND_TIMEOUT_MS = 10_000;

async function sendViaResendApi({ from, to, subject, html, text, attachments, replyTo }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text,
        reply_to: replyTo,
        // Resend's API takes base64-encoded content per attachment, unlike nodemailer's
        // path/Buffer-flexible shape — no caller currently passes attachments (see mailer.js
        // history), but this keeps the interface forward-compatible if one ever does.
        attachments: attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
        })),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API responded ${res.status}: ${body.slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

let transporter = null;
let loggedFallbackNotice = false;

function getSmtpTransporter() {
  if (transporter) return transporter;

  if (SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      // nodemailer's defaults (2 min connection, 10 min socket) are meant for long-running batch
      // senders — every caller here either awaits this inline in a request handler or fires it in
      // the background off one, so a stuck SMTP connection should fail fast rather than tie up
      // resources or (worse, if a caller ever forgets to background it) hang the HTTP response
      // itself well past any reasonable client timeout.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    return transporter;
  }

  // Neither RESEND_API_KEY nor SMTP_HOST configured — log instead of sending.
  transporter = {
    sendMail: async ({ to, subject, html, attachments }) => {
      if (!loggedFallbackNotice) {
        logger.info('No RESEND_API_KEY/SMTP_HOST configured — emails will be logged here instead of sent.');
        loggedFallbackNotice = true;
      }
      logger.debug(
        { to, subject, attachments: attachments?.map((a) => a.filename) },
        html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      );
      return { logged: true };
    },
  };
  return transporter;
}

export async function sendMail({ to, subject, html, attachments, replyTo }) {
  const from = SMTP_FROM;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    // Some hosts block outbound SMTP on every port at the connection level regardless of
    // credentials (see config/env.js) — a plain HTTPS call isn't subject to that, so it's
    // preferred whenever configured.
    if (RESEND_API_KEY) {
      await sendViaResendApi({ from, to, subject, html, text, attachments, replyTo });
    } else {
      await getSmtpTransporter().sendMail({ from, to, subject, html, text, attachments, replyTo });
    }
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email');
  }
}
