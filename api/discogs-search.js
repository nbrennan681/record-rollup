export default async function handler(req, res) {
  const query = req.query.q || '';
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Query too short' });
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ error: 'Token not configured' });

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://record-rollup.vercel.app',
    'Accept': 'application/json',
  };

  try {
    // Search both general query and artist-specific to catch more results
    const [r1, r2] = await Promise.all([
      fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=50`, { headers }),
      fetch(`https://api.discogs.com/database/search?artist=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=50`, { headers }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

    // Merge, deduplicate by release ID, artist search results first
    const seen = new Set();
    const merged = [...(d2.results || []), ...(d1.results || [])].filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    const results = merged
      .filter(item => item.cover_image ? !item.cover_image.includes('spacer') : true)
      .slice(0, 50);

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
