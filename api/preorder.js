import { Redis } from '@upstash/redis';

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

  const name = (body?.name || '').toString().trim();
  const email = (body?.email || '').toString().trim().toLowerCase();
  const quantity = Math.min(12, Math.max(1, parseInt(body?.quantity, 10) || 1));

  if (name.length < 2) {
    return res.status(400).json({ detail: 'Enter your name.' });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ detail: 'Enter a valid email address.' });
  }

  try {
    const redis = Redis.fromEnv();
    const order = { name, email, quantity, status: 'reserved', created_at: Date.now() };
    await redis.rpush('preorders', JSON.stringify(order));
    return res.json({ success: true, message: "Reserved! We'll email you when your order is ready.", quantity });
  } catch (err) {
    return res.status(500).json({ detail: 'Storage not configured. Set up Upstash Redis.', error: String(err?.message || err) });
  }
}
