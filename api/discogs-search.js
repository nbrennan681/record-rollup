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

  // Returns ONLY the median from completed sales. Never falls back to listing price.
  // Returns null if the release has no all-time sales history.
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

  try {
    // type=release + format=vinyl ensures we get specific vinyl pressing IDs
    // (not master IDs) which are required for marketplace/stats to work
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=50`
    );

    // Filter to results that have cover art — keep ALL variants/pressings (no deduplication)
    const candidates = (data?.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 30); // Cap at 30 to stay within Vercel timeout

    // Fetch real median prices for all candidates in parallel
    const withPrices = await Promise.all(
      candidates.map(async item => {
        const median = await getMedianPrice(item.id);
        return { ...item, avg_price: median, has_real_price: median !== null };
      })
    );

    // Only return records that have actual completed sale history
    const results = withPrices.filter(item => item.has_real_price);

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
