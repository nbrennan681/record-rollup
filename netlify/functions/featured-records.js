exports.handler = async function (event) {
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
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return res.json();
  }

  // Rotate through curated searches so the page feels fresh
  const queries = [
    'jazz vinyl',
    'hip-hop vinyl classic',
    'soul funk vinyl',
    'indie rock vinyl',
    'electronic vinyl',
    'classic rock vinyl',
  ];
  const pick = queries[Math.floor(Date.now() / (1000 * 60 * 60 * 6)) % queries.length];

  try {
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(pick)}&type=master&format=vinyl&sort=have&sort_order=desc&per_page=48`
    );

    const results = (data?.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 40);

    // Enrich top 12 with pricing
    const enriched = await Promise.all(
      results.slice(0, 12).map(async (item) => {
        try {
          const masterDetail = await discogsFetch(`https://api.discogs.com/masters/${item.id}`);
          const releaseId = masterDetail?.main_release;
          if (!releaseId) return { ...item, avg_price: null };

          const suggestions = await discogsFetch(
            `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`
          );
          if (!suggestions) return { ...item, avg_price: null };

          const nm  = suggestions['Near Mint (NM or M-)']?.value;
          const vgp = suggestions['Very Good Plus (VG+)']?.value;
          const vg  = suggestions['Very Good (VG)']?.value;

          const weighted = [
            ...(nm  ? [nm, nm, nm]    : []),
            ...(vgp ? [vgp, vgp, vgp] : []),
            ...(vg  ? [vg]            : []),
          ].filter(v => v > 0);

          const avg_price = weighted.length
            ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length)
            : null;

          return { ...item, avg_price, has_real_price: true };
        } catch {
          return { ...item, avg_price: null };
        }
      })
    );

    const final = [...enriched, ...results.slice(12)];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600', // cache for 1 hour
      },
      body: JSON.stringify({ results: final }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
