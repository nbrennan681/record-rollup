export default async function handler(req, res) {
  const { id: userId } = req.query;

  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ error: 'Storage not configured' });
  }

  const response = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });

  if (!response.ok) {
    return res.status(500).json({ error: 'Failed to fetch' });
  }

  const { result } = await response.json();
  if (!result) {
    return res.status(200).json({ collection: [], wantlist: [], conditions: {} });
  }

  try {
    const data = JSON.parse(result);
    return res.status(200).json(data);
  } catch {
    return res.status(200).json({ collection: [], wantlist: [], conditions: {} });
  }
}
