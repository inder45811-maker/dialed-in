import { kv } from '@vercel/kv';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const email = (body?.email || '').toString().trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ detail: 'Enter a valid email address.' });
  }

  try {
    const already = await kv.sismember('waitlist:emails', email);
    if (already) {
      return res.json({ success: true, message: "You're already on the list!", duplicate: true });
    }
    await kv.sadd('waitlist:emails', email);
    await kv.rpush('waitlist:ordered', email);
    return res.json({ success: true, message: "You're on the list. Watch your inbox." });
  } catch (err) {
    return res.status(500).json({ detail: 'Storage not configured. Set up Vercel KV.', error: String(err?.message || err) });
  }
}
