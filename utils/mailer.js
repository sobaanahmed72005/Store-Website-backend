import nodemailer from 'nodemailer';
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } from '../config/env.js';
import { logger } from './logger.js';

let transporter = null;
let loggedFallbackNotice = false;

function getTransporter() {
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

  // No SMTP configured (or outbound SMTP isn't reachable in this environment) — log instead of sending.
  transporter = {
    sendMail: async ({ to, subject, html, attachments }) => {
      if (!loggedFallbackNotice) {
        logger.info('No SMTP_HOST configured — emails will be logged here instead of sent. Set SMTP_HOST/PORT/USER/PASS in backend/.env to send real emails.');
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
  try {
    const from = SMTP_FROM;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    await getTransporter().sendMail({ from, to, subject, html, text, attachments, replyTo });
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email');
  }
}
