import { Redis } from '@upstash/redis';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ML_BASE = 'https://connect.mailerlite.com/api';

async function addToNewsletter(email, name) {
  const key = process.env.MAILERLITE_API_KEY;
  const group = process.env.MAILERLITE_GROUP_ID;
  if (!key || !group) return false;
  const resp = await fetch(`${ML_BASE}/subscribers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email, fields: { name }, groups: [group] }),
  });
  return resp.ok;
}

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
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    const order = { name, email, quantity, status: 'reserved', created_at: Date.now() };
    await redis.rpush('preorders', JSON.stringify(order));
    // Also subscribe to the newsletter (best-effort, non-blocking)
    try { await addToNewsletter(email, name); } catch (e) { /* ignore */ }
    return res.json({ success: true, message: "Reserved! We'll email you when your order is ready.", quantity });
  } catch (err) {
    return res.status(500).json({ detail: 'Storage not configured. Set up Upstash Redis.', error: String(err?.message || err) });
  }
}
