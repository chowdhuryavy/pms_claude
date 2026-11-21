/**
 * Pass-through for the Apps Script API. The browser calls /api/pms on this site, and this
 * function forwards the same body to the Apps Script web app and returns its reply.
 *
 * Why: Apps Script does not send the CORS header a browser needs to read a reply from another
 * site. Calls made here are same-site, so no CORS header is needed.
 *
 * Uses VITE_API_URL (the /exec address), the same value the frontend build reads.
 * The reply is passed on unchanged; nothing is logged.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: { code: 'METHOD', message: 'Method not allowed' } });
  }
  const target = process.env.VITE_API_URL;
  if (!target) {
    return res.status(500).json({ ok: false, error: { code: 'CONFIG', message: 'The server address is not set in Vercel.' } });
  }
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: raw,
      redirect: 'follow'
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(text);
  } catch {
    return res.status(502).json({ ok: false, error: { code: 'NETWORK', message: 'Cannot reach the Apps Script server.' } });
  }
}
