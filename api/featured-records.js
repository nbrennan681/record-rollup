export default async function handler(req, res) {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ error: 'Token not configured' });

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://record-rollup.vercel.app',
    'Accept': 'application/json',
  };

  const queries = ['jazz', 'hip-hop', 'soul', 'indie rock', 'electronic', 'classic rock'];
  const pick = queries[Math.floor(Date.now() / (1000 * 60 * 60 * 6)) % queries.length];

  try {
    const r = await fetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(pick)}&type=master&format=vinyl&sort=have&sort_order=desc&per_page=48`,
      { headers }
    );
    if (!r.ok) throw new Error('Discogs error ' + r.status);
    const data = await r.json();

    const results = (data.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 36);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
