exports.handler = async function (event) {
  const query = event.queryStringParameters?.q || '';

  if (!query || query.length < 2) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Query too short' }),
    };
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Discogs token not configured' }),
    };
  }

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://recordrollup.app',
    'Accept': 'application/json',
  };

  try {
    // Search for releases
    const searchUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&per_page=25`;
    const res = await fetch(searchUrl, { headers });

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `Discogs error: ${res.status}` }),
      };
    }

    const data = await res.json();
    const results = data.results || [];

    // For up to 8 results, fetch real marketplace pricing from price suggestions
    const enriched = await Promise.all(
      results.slice(0, 8).map(async (item) => {
        if (!item.id) return item;
        try {
          const priceRes = await fetch(
            `https://api.discogs.com/marketplace/price_suggestions/${item.id}`,
            { headers }
          );
          if (!priceRes.ok) return item;
          const prices = await priceRes.json();
          // Weight towards NM and VG+ — the standard vinyl trading grades
          // Give NM 3x weight, VG+ 3x, VG 1x, ignore G and M (outliers)
          const weighted = [
            prices['Mint (M)']?.value,
            prices['Near Mint (NM or M-)']?.value * 3,
            prices['Very Good Plus (VG+)']?.value * 3,
            prices['Very Good (VG)']?.value,
          ].filter(v => typeof v === 'number' && v > 0);
          const avgPrice = weighted.length
            ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length)
            : null;
          return {
            ...item,
            avg_price: avgPrice,
          };
        } catch {
          return item;
        }
      })
    );

    // Remaining results pass through without price enrichment
    const final = [...enriched, ...results.slice(8)];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ ...data, results: final }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
