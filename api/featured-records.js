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

  // Returns ONLY the median from completed sales. Never falls back to listing price.
  async function getMedianPrice(releaseId) {
    try {
      const stats = await discogsFetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=USD`
      );
      if (!stats || stats.blocked_from_sale) return null;
      const median = stats.median?.value;
      return (median && median > 0) ? Math.round(median) : null;
    } catch { return null; }
  }

  const queries = ['jazz', 'hip-hop', 'soul', 'indie rock', 'electronic', 'classic rock'];
  const pick = queries[Math.floor(Date.now() / (1000 * 60 * 60 * 6)) % queries.length];

  try {
    // type=release so we get real release IDs usable with marketplace/stats
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(pick)}&type=release&format=vinyl&sort=have&sort_order=desc&per_page=60`
    );
    if (!data) throw new Error('Discogs fetch failed');

    // For the home page, deduplicate by title so we get variety across artists
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
      .slice(0, 32); // Fetch stats for up to 32 unique titles

    // Fetch real median prices for all in parallel
    const withPrices = await Promise.all(
      unique.map(async item => {
        const median = await getMedianPrice(item.id);
        return { ...item, avg_price: median, has_real_price: median !== null };
      })
    );

    // Only show records with verified median sale prices — no estimates
    const results = withPrices.filter(item => item.has_real_price).slice(0, 24);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
