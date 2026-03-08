export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, collection, wantlist, conditions } = req.body;
  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ error: 'Storage not configured' });
  }

  const payload = JSON.stringify({ collection, wantlist, conditions, updatedAt: new Date().toISOString() });

  const response = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return res.status(500).json({ error: 'Failed to save' });
  }

  return res.status(200).json({ ok: true });
}
