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

  const queries = ['jazz', 'hip-hop', 'soul', 'indie rock', 'electronic', 'classic rock'];
  const pick = queries[Math.floor(Date.now() / (1000 * 60 * 60 * 6)) % queries.length];

  try {
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(pick)}&type=release&format=vinyl&sort=have&sort_order=desc&per_page=60`
    );
    if (!data) throw new Error('Discogs fetch failed');

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
      .slice(0, 20);

    const results = await batchPrices(unique);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
