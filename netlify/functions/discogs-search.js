exports.handler = async function (event) {
  const query = event.queryStringParameters?.q || '';
  if (!query || query.length < 2) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Query too short' }) };
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Discogs token not configured' }) };
  }

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://recordrollup.app',
    'Accept': 'application/json',
  };

  async function discogsFetch(url) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  function normaliseTitle(raw) {
    let title = raw || '';
    if (title.includes(' - ')) title = title.split(' - ').slice(1).join(' - ');
    return title.toLowerCase()
      .replace(/\s*\(\d+\)\s*/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function getPriceForRelease(releaseId) {
    const suggestions = await discogsFetch(
      `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`
    );
    if (!suggestions) return null;
    const nm  = suggestions['Near Mint (NM or M-)']?.value;
    const vgp = suggestions['Very Good Plus (VG+)']?.value;
    const vg  = suggestions['Very Good (VG)']?.value;
    const weighted = [
      ...(nm  ? [nm,  nm,  nm ]  : []),
      ...(vgp ? [vgp, vgp, vgp]  : []),
      ...(vg  ? [vg]             : []),
    ].filter(v => typeof v === 'number' && v > 0);
    return weighted.length
      ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length)
      : null;
  }

  try {
    // Single search — masters only, which already deduplicates pressings
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=master&per_page=25`
    );

    const results = data?.results || [];

    // Deduplicate by title
    const seen = new Set();
    const unique = [];
    for (const item of results) {
      const key = normaliseTitle(item.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    // Only fetch pricing for top 3 — masters include main_release in search results
    // so we can skip the extra master detail call
    const enriched = await Promise.all(
      unique.slice(0, 3).map(async (item) => {
        // Discogs master search results include main_release directly
        const releaseId = item.main_release || item.id;
        const avg_price = await getPriceForRelease(releaseId);
        return { ...item, avg_price, has_real_price: avg_price !== null };
      })
    );

    const final = [...enriched, ...unique.slice(3)];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // cache 5 mins
      },
      body: JSON.stringify({ results: final }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
