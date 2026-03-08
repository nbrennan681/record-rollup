function estimateVinylPrice(genre, year) {
  let base = 22;
  if (year && year < 1965) base = 70;
  else if (year && year < 1975) base = 48;
  else if (year && year < 1985) base = 35;
  else if (year && year < 1995) base = 25;
  else if (year && year >= 2015) base = 30;
  if (/jazz|blues/i.test(genre))    base = Math.round(base * 1.4);
  if (/soul|funk|r&b/i.test(genre)) base = Math.round(base * 1.2);
  if (/hip.hop|rap/i.test(genre))   base = Math.round(base * 1.15);
  if (/classical/i.test(genre))     base = Math.round(base * 0.7);
  return base;
}

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

  // Only trust lowest_price when at least 3 copies are for sale — filters outlier listings
  async function getPrice(releaseId, genre, year) {
    try {
      const stats = await discogsFetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=USD`
      );
      if (stats && !stats.blocked_from_sale && stats.num_for_sale >= 3 && stats.lowest_price?.value > 0) {
        return { price: Math.round(stats.lowest_price.value), label: 'from' };
      }
    } catch { /* fall through */ }
    return { price: estimateVinylPrice(genre, year), label: 'est' };
  }

  // Batched to stay within Discogs rate limits (60 req/min)
  async function batchPrices(items, batchSize = 5) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async item => {
          const genre = item.genre?.[0] || item.style?.[0] || '';
          const year  = parseInt(item.year) || 0;
          const result = await getPrice(item.id, genre, year);
          return {
            ...item,
            avg_price: result.price,
            price_label: result.label,
            has_real_price: result.label === 'from',
          };
        })
      );
      results.push(...batchResults);
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

    const candidates = (data?.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 20);

    const results = await batchPrices(candidates);

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
