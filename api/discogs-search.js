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

  try {
    const r = await fetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=50`,
      { headers }
    );
    if (!r.ok) throw new Error('Discogs error ' + r.status);
    const data = await r.json();

    const results = (data.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 24)
      .map(item => {
        const genre = item.genre?.[0] || item.style?.[0] || '';
        const year  = parseInt(item.year) || 0;
        return {
          ...item,
          avg_price: estimateVinylPrice(genre, year),
          price_label: 'est',
          has_real_price: false,
        };
      });

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
