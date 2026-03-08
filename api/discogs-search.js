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

  async function discogsFetch(url) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }

  async function getMedianPrice(releaseId) {
    try {
      const stats = await discogsFetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=USD`
      );
      if (!stats || stats.blocked_from_sale) return null;
      const median = stats.median?.value;
      if (median && median > 0) return Math.round(median);
      const lowest = stats.lowest_price?.value;
      return lowest && lowest > 0 ? Math.round(lowest) : null;
    } catch { return null; }
  }

  try {
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=50`
    );

    const seen = new Set();
    const unique = (data?.results || []).filter(item => {
      if (!item.cover_image || item.cover_image.includes('spacer')) return false;
      let titlePart = item.title || '';
      if (titlePart.includes(' - ')) titlePart = titlePart.split(' - ').slice(1).join(' - ');
      // Dedupe by title only — suppress reprints/reissues of same album
      const key = titlePart.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);

    // Fetch median prices for top 6 in parallel
    const enriched = await Promise.all(
      unique.slice(0, 6).map(async item => {
        const avg_price = await getMedianPrice(item.id);
        return { ...item, avg_price, has_real_price: avg_price !== null };
      })
    );

    const final = [...enriched, ...unique.slice(6)];

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ results: final });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
