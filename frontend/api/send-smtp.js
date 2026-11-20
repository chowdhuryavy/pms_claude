/**
 * SMTP relay for the PMS backend. Apps Script cannot open SMTP connections, so it posts
 * each message here and this function sends it over SMTP with nodemailer.
 *
 * Security:
 * - Every request must carry the shared secret in the X-Relay-Secret header. The secret is
 *   set in Vercel as MAIL_RELAY_SECRET and in the PMS email settings (stored encrypted).
 * - SMTP credentials arrive only over HTTPS, and are used once to send. They are not logged.
 * - Errors returned to the caller never include credentials or server details.
 *
 * Deploys with the frontend on Vercel at /api/send-smtp.
 */
import { timingSafeEqual } from 'node:crypto';

function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isEmail(v) {
  return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  }
  if (!secretMatches(req.headers['x-relay-secret'], process.env.MAIL_RELAY_SECRET)) {
    return res.status(401).json({ ok: false, error: { message: 'Unauthorized' } });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { from, to, subject, html, text, smtp } = body;
  if (!from || !isEmail(from.email) || !isEmail(to) || typeof subject !== 'string' || !subject) {
    return res.status(400).json({ ok: false, error: { message: 'Invalid message' } });
  }
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass || !Number.isInteger(smtp.port)) {
    return res.status(400).json({ ok: false, error: { message: 'Invalid SMTP settings' } });
  }

  // Loaded here so the security checks above run even if the package is missing.
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure === true,
    requireTLS: smtp.secure !== true,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000
  });

  try {
    await transport.sendMail({
      from: from.name ? `"${String(from.name).replace(/"/g, '')}" <${from.email}>` : from.email,
      to,
      subject,
      html: typeof html === 'string' ? html : undefined,
      text: typeof text === 'string' ? text : undefined
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Log the code only. The detailed error can include server names and must not reach the caller.
    console.error('SMTP send failed', err && err.code ? err.code : 'unknown');
    return res.status(502).json({ ok: false, error: { message: 'SMTP send failed' } });
  }
}
