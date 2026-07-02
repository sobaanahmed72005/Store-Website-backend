import nodemailer from 'nodemailer';

let transporter = null;
let loggedFallbackNotice = false;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return transporter;
  }

  // No SMTP configured (or outbound SMTP isn't reachable in this environment) — log instead of sending.
  transporter = {
    sendMail: async ({ to, subject, html, attachments }) => {
      if (!loggedFallbackNotice) {
        console.log('No SMTP_HOST configured — emails will be logged here instead of sent. Set SMTP_HOST/PORT/USER/PASS in backend/.env to send real emails.');
        loggedFallbackNotice = true;
      }
      const attNote = attachments?.length ? `\nAttachments: ${attachments.map((a) => a.filename).join(', ')}` : '';
      console.log(`\n--- EMAIL (not sent — no SMTP configured) ---\nTo: ${to}\nSubject: ${subject}${attNote}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n--- END EMAIL ---\n`);
      return { logged: true };
    },
  };
  return transporter;
}

export async function sendMail({ to, subject, html, attachments, replyTo }) {
  try {
    const from = process.env.SMTP_FROM || 'YourITstore <no-reply@youritstore.com>';
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    await getTransporter().sendMail({ from, to, subject, html, text, attachments, replyTo });
  } catch (err) {
    console.error('Failed to send email:', err.message);
  }
}
