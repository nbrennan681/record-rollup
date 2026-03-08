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

  // Returns ONLY the median from completed sales. null = no sales history.
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

  // Process in batches of 5 to avoid hammering Discogs rate limits (60 req/min)
  async function batchMedianPrices(items, batchSize = 5) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async item => {
          const median = await getMedianPrice(item.id);
          return { ...item, avg_price: median, has_real_price: median !== null };
        })
      );
      results.push(...batchResults);
      // Small delay between batches to respect rate limits
      if (i + batchSize < items.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    return results;
  }

  try {
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=50`
    );

    // Keep all variants/pressings — filter only for cover art
    const candidates = (data?.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 20); // 20 candidates → 4 batches of 5, well within rate limits

    const withPrices = await batchMedianPrices(candidates);

    // Only return records with real completed-sale median prices
    const results = withPrices.filter(item => item.has_real_price);

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
