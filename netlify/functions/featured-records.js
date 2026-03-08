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

  // Rotate genre query every 6 hours
  const queries = ['jazz', 'hip-hop', 'soul', 'indie rock', 'electronic', 'classic rock'];
  const pick = queries[Math.floor(Date.now() / (1000 * 60 * 60 * 6)) % queries.length];

  try {
    const res = await fetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(pick)}&type=master&format=vinyl&sort=have&sort_order=desc&per_page=40`,
      { headers }
    );
    if (!res.ok) throw new Error('Discogs error ' + res.status);
    const data = await res.json();

    // Filter to only results with real cover art — no pricing calls on launch
    const results = (data.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 36);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600', // cache 1 hour
      },
      body: JSON.stringify({ results }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
