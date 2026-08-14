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

  const email = (body?.email || '').toString().trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ detail: 'Enter a valid email address.' });
  }

  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    const already = await redis.sismember('waitlist:emails', email);
    if (already) {
      return res.json({ success: true, message: "You're already on the list!", duplicate: true });
    }
    await redis.sadd('waitlist:emails', email);
    await redis.rpush('waitlist:ordered', email);
    return res.json({ success: true, message: "You're on the list. Watch your inbox." });
  } catch (err) {
    return res.status(500).json({ detail: 'Storage not configured. Set up Upstash Redis.', error: String(err?.message || err) });
  }
}
