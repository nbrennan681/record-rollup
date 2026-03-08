export default async function handler(req, res) {
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

  // Get median vinyl sale price for a specific release ID
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

  const queries = ['jazz', 'hip-hop', 'soul', 'indie rock', 'electronic', 'classic rock'];
  const pick = queries[Math.floor(Date.now() / (1000 * 60 * 60 * 6)) % queries.length];

  try {
    // Use type=release so IDs are actual release IDs usable with marketplace/stats
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(pick)}&type=release&format=vinyl&sort=have&sort_order=desc&per_page=60`
    );
    if (!data) throw new Error('Discogs fetch failed');

    // Deduplicate by title (not title+year) to avoid same album appearing multiple times
    const seen = new Set();
    const unique = (data.results || [])
      .filter(item => {
        if (!item.cover_image || item.cover_image.includes('spacer')) return false;
        let titlePart = item.title || '';
        if (titlePart.includes(' - ')) titlePart = titlePart.split(' - ').slice(1).join(' - ');
        const key = titlePart.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 36);

    // Fetch real median prices for first 12 in parallel
    const enriched = await Promise.all(
      unique.slice(0, 12).map(async item => {
        const avg_price = await getMedianPrice(item.id);
        return { ...item, avg_price, has_real_price: avg_price !== null };
      })
    );

    const results = [...enriched, ...unique.slice(12)];

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
